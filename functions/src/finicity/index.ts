
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as params from "../config/params";

const FINICITY_PARTNER_ID = params.FINICITY_PARTNER_ID.value();
const FINICITY_PARTNER_SECRET = params.FINICITY_PARTNER_SECRET.value();
const FINICITY_APP_KEY = params.FINICITY_APP_KEY.value();
const FINICITY_API_BASE_URL = "https://api.finicity.com";
const FINICITY_EXPERIENCE_GUID = params.FINICITY_EXPERIENCE_GUID.value();

interface FinicityToken {
  token: string;
  expires: number;
}

/**
 * Simple in-memory cache for the Finicity API token.
 */
let apiTokenCache: FinicityToken | null = null;

/**
 * Gets a Finicity API token, using a cached one if available and not expired.
 * @return {Promise<string>} A Promise that resolves with the Finicity API token.
 */
async function getFinicityApiToken(): Promise<string> {
  if (!FINICITY_PARTNER_ID || !FINICITY_PARTNER_SECRET || !FINICITY_APP_KEY) {
    logger.error("Finicity credentials are not configured in environment variables.");
    throw new HttpsError("failed-precondition", "The Finicity integration is not configured.");
  }

  if (apiTokenCache && apiTokenCache.expires > Date.now()) {
    return apiTokenCache.token;
  }

  const response = await fetch(`${FINICITY_API_BASE_URL}/aggregation/v2/partners/authentication`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Finicity-App-Key": FINICITY_APP_KEY as string,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      partnerId: FINICITY_PARTNER_ID,
      partnerSecret: FINICITY_PARTNER_SECRET,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("Failed to get Finicity token:", {status: response.status, body: errorBody});
    throw new HttpsError("internal", "Could not authenticate with Finicity.");
  }

  const data = await response.json();
  /**
   * Cache the token with a 5-minute buffer (Finicity tokens last 2 hours).
   * @type {FinicityToken}
   */
  apiTokenCache = {
    token: data.token,
    expires: Date.now() + (120 - 5) * 60 * 1000,
  };
  // Return the newly acquired and cached token.
  return apiTokenCache.token;
}

/**
 * Creates or gets a Finicity customer for the given Firebase user ID.
 * @param {string} userId - The Firebase user ID.
 * @param {string} token - The Finicity API authentication token.
 * @return {Promise<string>} A Promise that resolves with the Finicity customer ID.
 */
async function getOrCreateFinicityCustomer(userId: string, token: string): Promise<string> {
  const userDocRef = db.collection("users").doc(userId);
  const userDoc = await userDocRef.get();
  const userData = userDoc.data();

  if (userData?.finicityCustomerId) {
    return userData.finicityCustomerId;
  }

  const userRecord = await admin.auth().getUser(userId);
  const response = await fetch(`${FINICITY_API_BASE_URL}/aggregation/v2/customers/testing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Finicity-App-Key": FINICITY_APP_KEY as string,
      "Finicity-App-Token": token,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      username: userRecord.email || `verza-user-${userId}`,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("Failed to create Finicity customer:", {status: response.status, body: errorBody});
    throw new HttpsError("internal", "Failed to create a Finicity customer record.");
  }

  const customerData = await response.json();
  const finicityCustomerId = customerData.id;
  await userDocRef.set({finicityCustomerId}, {merge: true});
  return finicityCustomerId;
}

/**
 * Handles incoming requests to generate a Finicity Connect URL for the authenticated user.
 * This is a callable function that retrieves the necessary Finicity customer and API token,
 * then calls the Finicity API to generate a Connect URL.
 * @param {object} data - The data passed to the callable function (unused in this case, as auth provides user ID).
 * @returns {Promise<{connectUrl: string}>} A Promise that resolves with an object containing the generated Finicity Connect URL.
 * Callable function to generate a Finicity Connect URL for a user.
 * @param {object} data - The data passed to the callable function (unused in this case, as auth provides user ID).
 */
export const generateFinicityConnectUrl = onCall({
  enforceAppCheck: false,
  cors: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  // Safely access the user ID, throwing an error if not authenticated (which is already checked above)
  // We use a non-null assertion here because the check 'if (!request.auth)' guarantees request.auth is defined.
  // Alternatively, you could use:
  // const userId = request.auth?.uid; if handling unauthenticated case differently
  const userId = request.auth.uid;

  try {
    const token = await getFinicityApiToken();
    const finicityCustomerId = await getOrCreateFinicityCustomer(userId, token);

    const appUrl = params.APP_URL.value();
    if (!appUrl) {
      throw new HttpsError("failed-precondition", "The application's base URL (APP_URL) is not configured.");
    }
    const webhookUrl = params.FINICITY_WEBHOOK_URL.value();
    if (!webhookUrl) {
      throw new HttpsError("failed-precondition", "The Finicity webhook URL is not configured.");
    }

    if (!FINICITY_EXPERIENCE_GUID) {
      throw new HttpsError("failed-precondition", "The Finicity Experience GUID is not configured.");
    }

    const response = await fetch(`${FINICITY_API_BASE_URL}/connect/v2/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Finicity-App-Key": FINICITY_APP_KEY as string,
        "Finicity-App-Token": token,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        partnerId: FINICITY_PARTNER_ID,
        customerId: finicityCustomerId,
        redirectUri: `${appUrl}/banking?reason=complete&code=200`, // Added params for clarity on redirect
        webhook: webhookUrl,
        webhookContentType: "application/json",
        experience: FINICITY_EXPERIENCE_GUID,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error("Failed to generate Finicity Connect URL:", {status: response.status, body: errorBody});
      throw new HttpsError("internal", "Could not generate Finicity Connect URL.");
    }

    /**
 * Successfully generated Finicity Connect URL.
 * @type {{connectUrl: string}}
 */
    const data = await response.json();
    logger.info("Successfully generated Finicity Connect URL.", {customerId: finicityCustomerId});
    // Returning the connect URL data
    return {connectUrl: data.link};
  } catch (error) {
    logger.error("Error in generateFinicityConnectUrl:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while setting up bank connection.");
  }
}
);

/**
 * Fetches and stores transactions for a given account. It handles pagination and the 180-day limit.
 * @param {string} userId - The Firebase user ID.
 * @param {string} finicityCustomerId - The Finicity customer ID.
 * @param {string} token - The Finicity API authentication token.
 * @param {admin.firestore.WriteBatch} batch - The Firestore batch to add transaction write operations to.
 * @return {Promise<void>} A Promise that resolves when transactions are fetched and added to the batch.
 */
async function fetchAndStoreTransactions(userId: string, finicityCustomerId: string,
  token: string, batch: admin.firestore.WriteBatch) {
  const TOTAL_MONTHS_TO_FETCH = 3;
  const DAYS_PER_FETCH = 180;
  const now = new Date();

  // Loop back in 180-day increments for up to 3 months
  for (let i = 0; i < (TOTAL_MONTHS_TO_FETCH * 30) / DAYS_PER_FETCH; i++) {
    const toDate = new Date(now);
    toDate.setDate(now.getDate() - (i * DAYS_PER_FETCH));
    const fromDate = new Date(now);
    fromDate.setDate(now.getDate() - ((i + 1) * DAYS_PER_FETCH));

    let hasMore = true;
    let nextStart = 1;

    // Handle pagination within the 180-day window
    while (hasMore) {
      const transactionsUrl =
        new URL(`${FINICITY_API_BASE_URL}/aggregation/v3/customers/${finicityCustomerId}/transactions`);
      const fromDateInSeconds = Math.floor(fromDate.getTime() / 1000);
      const toDateInSeconds = Math.floor(toDate.getTime() / 1000);

      transactionsUrl.searchParams.set("fromDate", fromDateInSeconds.toString());
      transactionsUrl.searchParams.set("toDate", toDateInSeconds.toString());
      transactionsUrl.searchParams.set("start", nextStart.toString());
      transactionsUrl.searchParams.set("limit", "1000"); // Max limit

      const txResponse = await fetch(transactionsUrl.toString(), {
        headers: {"Finicity-App-Key": FINICITY_APP_KEY as string, "Finicity-App-Token": token, "Accept": "application/json"},
      });

      if (!txResponse.ok) {
        logger.error(`Failed to fetch transactions for customer ${finicityCustomerId} in date range ${fromDate} - ${toDate}`,
          {status: txResponse.status, url: transactionsUrl.toString()});
        hasMore = false; // Stop trying for this chunk if an error occurs
        continue;
      }

      const {transactions, displaying, moreAvailable} = await txResponse.json();
      if (transactions && transactions.length > 0) {
        for (const tx of transactions) {
          const txDocRef = db.collection("users").doc(userId).collection("bankTransactions").doc(tx.id.toString());
          batch.set(txDocRef, {
            userId,
            accountId: tx.accountId,
            providerTransactionId: tx.id,
            date: new Date(tx.postedDate * 1000).toISOString(),
            description: tx.description,
            amount: tx.amount,
            currency: tx.currencySymbol || "USD",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }
      }

      if (moreAvailable) {
        nextStart = displaying + 1;
      } else {
        hasMore = false;
      }
    }
  }
}


/**
 * Fetches the current list of accounts from Finicity and synchronizes them with Firestore.
 * This includes adding new accounts, updating existing ones, and deleting those no longer present.
 * @param {string} userId - The Firebase user ID.
 * @param {string} finicityCustomerId - The Finicity customer ID.
 * @param {string} token - The Finicity API authentication token.
 * @return {Promise<void>}
 */
async function syncAllAccountsAndTransactions(userId: string, finicityCustomerId: string, token: string) {
  // 1. Fetch current accounts from Finicity
  const accountsResponse = await fetch(`${FINICITY_API_BASE_URL}/aggregation/v1/customers/${finicityCustomerId}/accounts`, {
    headers: {"Finicity-App-Key": FINICITY_APP_KEY as string, "Finicity-App-Token": token, "Accept": "application/json"},
  });

  if (!accountsResponse.ok) {
    logger.error("Failed to fetch accounts for synchronization for customer", finicityCustomerId);
    return;
  }
  const {accounts: finicityAccounts} = await accountsResponse.json();
  const finicityAccountIds = new Set(finicityAccounts.map((acc: any) => acc.id.toString()));

  // 2. Get existing accounts from Firestore
  const firestoreAccountsRef = db.collection("users").doc(userId).collection("bankAccounts");
  const firestoreSnapshot = await firestoreAccountsRef.get();
  const firestoreAccountIds = new Set(firestoreSnapshot.docs.map((doc) => doc.id));

  // 3. Determine accounts to delete
  const accountsToDelete = [...firestoreAccountIds].filter((id) => !finicityAccountIds.has(id));

  // 4. Batch all database operations
  const batch = db.batch();

  // Handle deletions
  if (accountsToDelete.length > 0) {
    for (const accountId of accountsToDelete) {
      const accountDocRef = firestoreAccountsRef.doc(accountId);
      batch.delete(accountDocRef);
    }
    logger.info(`Marked ${accountsToDelete.length} stale accounts for deletion for user ${userId}.`);
  }

  // Handle additions/updates
  for (const account of finicityAccounts) {
    const accountDocRef = firestoreAccountsRef.doc(account.id.toString());
    batch.set(accountDocRef, {
      userId,
      providerAccountId: account.id,
      name: account.name,
      officialName: account.officialName || null,
      mask: account.number,
      type: account.type,
      subtype: account.detail?.type || null,
      balance: account.balance,
      provider: "Finicity",
      // Use serverTimestamp for new docs, don't overwrite on updates
      createdAt: firestoreAccountIds.has(account.id.toString()) ? null : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  // Fetch and store transactions for ALL accounts for this customer
  await fetchAndStoreTransactions(userId, finicityCustomerId, token, batch);

  // 5. Commit all changes
  await batch.commit();
  logger.info(`Synchronized ${finicityAccounts.length} accounts and their transactions for user ${userId}.`);
}

/**
 * Webhook handler for Finicity events.
 */
export const finicityWebhookHandler = onRequest({cors: true, timeoutSeconds: 300}, async (request, response) => {
  logger.info("Finicity webhook received a request.", {body: request.body});

  try {
    const event = request.body;

    // A more robust check: trigger if we get any event with a customer ID.
    if (event.customerId) {
      const finicityCustomerId = event.customerId.toString();
      const usersRef = db.collection("users");
      const snapshot = await usersRef.where("finicityCustomerId", "==", finicityCustomerId).limit(1).get();

      if (snapshot.empty) {
        logger.error("No user found for Finicity customer ID:", finicityCustomerId);
        response.status(404).send("User not found");
        return;
      }

      const userDoc = snapshot.docs[0];
      const userId = userDoc.id;

      logger.info(`Processing webhook event for user ${userId}. Refreshing all accounts.`);

      const token = await getFinicityApiToken();
      // Sync all accounts, which includes fetching, adding, updating, and deleting.
      await syncAllAccountsAndTransactions(userId, finicityCustomerId, token);
    } else {
      logger.info("Webhook received, but it did not contain a customerId in the payload. Skipping.",
        {eventType: event.eventType});
    }

    response.status(204).send();
  } catch (error) {
    logger.error("Error in finicityWebhookHandler:", error);
    response.status(500).send("Internal Server Error");
  }
});
