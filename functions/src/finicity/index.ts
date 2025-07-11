
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";

const FINICITY_PARTNER_ID = process.env.FINICITY_PARTNER_ID;
const FINICITY_PARTNER_SECRET = process.env.FINICITY_PARTNER_SECRET;
const FINICITY_APP_KEY = process.env.FINICITY_APP_KEY;
const FINICITY_API_BASE_URL = "https://api.finicity.com";

interface FinicityToken {
  token: string;
  expires: number;
}

let apiTokenCache: FinicityToken | null = null;

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
  apiTokenCache = {
    token: data.token,
    expires: Date.now() + (120 - 5) * 60 * 1000,
  };
  return apiTokenCache.token;
}

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

export const generateFinicityConnectUrl = onCall({
  enforceAppCheck: false,
  cors: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const userId = request.auth.uid;

  try {
    const token = await getFinicityApiToken();
    const finicityCustomerId = await getOrCreateFinicityCustomer(userId, token);

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      throw new HttpsError("failed-precondition", "The application's base URL (APP_URL) is not configured.");
    }
    const webhookUrl = process.env.FINICITY_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new HttpsError("failed-precondition", "The Finicity webhook URL is not configured.");
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
        redirectUri: `${appUrl}/banking`,
        webhook: webhookUrl,
        webhookContentType: "application/json",
        experience: "{\"brand\":\"Verza\",\"logo\":\"\",\"product\":\"aggregation\"}",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error("Failed to generate Finicity Connect URL:", {status: response.status, body: errorBody});
      throw new HttpsError("internal", "Could not generate Finicity Connect URL.");
    }

    const data = await response.json();
    return {connectUrl: data.link};
  } catch (error) {
    logger.error("Error in generateFinicityConnectUrl:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while setting up bank connection.");
  }
});


async function fetchAndStoreAccounts(userId: string, finicityCustomerId: string, token: string) {
  const accountsResponse = await fetch(`${FINICITY_API_BASE_URL}/aggregation/v1/customers/${finicityCustomerId}/accounts`, {
    headers: {"Finicity-App-Key": FINICITY_APP_KEY!, "Finicity-App-Token": token, "Accept": "application/json"},
  });

  if (!accountsResponse.ok) {
    logger.error("Failed to fetch accounts for customer", finicityCustomerId);
    return;
  }

  const {accounts} = await accountsResponse.json();
  const batch = db.batch();

  for (const account of accounts) {
    const accountDocRef = db.collection("users").doc(userId).collection("bankAccounts").doc(account.id);
    batch.set(accountDocRef, {
      userId,
      providerAccountId: account.id,
      name: account.name,
      officialName: account.officialName,
      mask: account.number,
      type: account.type,
      subtype: account.detail?.type || null,
      balance: account.balance,
      provider: "Finicity",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    // Fetch and store transactions for this account
    await fetchAndStoreTransactions(userId, finicityCustomerId, account.id, token, batch);
  }
  await batch.commit();
  logger.info(`Stored ${accounts.length} accounts and their transactions for user ${userId}`);
}


async function fetchAndStoreTransactions(userId: string, finicityCustomerId: string, accountId: string, token: string, batch: admin.firestore.WriteBatch) {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - 90); // 90 days of transactions

  const transactionsUrl = new URL(`${FINICITY_API_BASE_URL}/aggregation/v4/customers/${finicityCustomerId}/accounts/${accountId}/transactions`);
  transactionsUrl.searchParams.set("fromDate", fromDate.getTime().toString());
  transactionsUrl.searchParams.set("toDate", toDate.getTime().toString());

  const txResponse = await fetch(transactionsUrl.toString(), {
    headers: {"Finicity-App-Key": FINICITY_APP_KEY!, "Finicity-App-Token": token, "Accept": "application/json"},
  });

  if (!txResponse.ok) {
    logger.error(`Failed to fetch transactions for account ${accountId}`);
    return;
  }

  const {transactions} = await txResponse.json();

  for (const tx of transactions) {
    const txDocRef = db.collection("users").doc(userId).collection("bankTransactions").doc(tx.id.toString());
    batch.set(txDocRef, {
      userId,
      accountId,
      providerTransactionId: tx.id,
      date: new Date(tx.postedDate * 1000).toISOString(),
      description: tx.description,
      amount: tx.amount,
      currency: tx.currencySymbol || "USD",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }
}

export const finicityWebhookHandler = onRequest({cors: true}, async (request, response) => {
  logger.info("Finicity webhook received a request.", {body: request.body});

  try {
    const event = request.body;
    if (event.type === "created" && event.payload.customerId) {
      const finicityCustomerId = event.payload.customerId;

      const usersRef = db.collection("users");
      const snapshot = await usersRef.where("finicityCustomerId", "==", finicityCustomerId).limit(1).get();

      if (snapshot.empty) {
        logger.error("No user found for Finicity customer ID:", finicityCustomerId);
        response.status(404).send("User not found");
        return;
      }

      const userDoc = snapshot.docs[0];
      const userId = userDoc.id;

      logger.info(`Processing new accounts for user ${userId}`);

      const token = await getFinicityApiToken();
      await fetchAndStoreAccounts(userId, finicityCustomerId, token);
    }
    response.status(204).send();
  } catch (error) {
    logger.error("Error in finicityWebhookHandler:", error);
    response.status(500).send("Internal Server Error");
  }
});
