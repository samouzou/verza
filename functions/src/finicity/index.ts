
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";

const FINICITY_PARTNER_ID = process.env.FINICITY_PARTNER_ID;
const FINICITY_PARTNER_SECRET = process.env.FINICITY_PARTNER_SECRET;
const FINICITY_APP_KEY = process.env.FINICITY_APP_KEY;
// Use the sandbox URL for development
const FINICITY_API_BASE_URL = "https://api.finicity.com";

interface FinicityToken {
  token: string;
  expires: number; // Expiration timestamp in milliseconds
}

// Simple in-memory cache for the API token
let apiTokenCache: FinicityToken | null = null;

/**
 * Gets a Finicity API token, using a cached one if available and not expired.
 */
async function getFinicityApiToken(): Promise<string> {
  if (!FINICITY_PARTNER_ID || !FINICITY_PARTNER_SECRET || !FINICITY_APP_KEY) {
    logger.error("Finicity credentials are not configured in environment variables.");
    throw new HttpsError("failed-precondition", "The Finicity integration is not configured.");
  }

  if (apiTokenCache && apiTokenCache.expires > Date.now()) {
    logger.info("Using cached Finicity API token.");
    return apiTokenCache.token;
  }

  logger.info("Requesting new Finicity API token.");
  const response = await fetch(`${FINICITY_API_BASE_URL}/aggregation/v2/partners/authentication`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Finicity-App-Key": FINICITY_APP_KEY as string, // Type assertion
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
  const token = data.token;

  // Cache the token with a 5-minute buffer (Finicity tokens last 2 hours)
  apiTokenCache = {
    token,
    expires: Date.now() + (120 - 5) * 60 * 1000,
  };

  return token;
}

/**
 * Creates or gets a Finicity customer for the given Firebase user ID.
 * @param {string} userId - The ID of the user for whom the Finicity customer is being created or retrieved.
 * @param {string} token - The Finicity API authentication token.
 */
async function getOrCreateFinicityCustomer(userId: string, token: string): Promise<string> {
  const userDocRef = db.collection("users").doc(userId);
  const userDoc = await userDocRef.get();
  const userData = userDoc.data();

  if (userData?.finicityCustomerId) {
    logger.info(`Found existing Finicity customer ID for user ${userId}`);
    return userData.finicityCustomerId;
  }

  logger.info(`Creating new Finicity customer for user ${userId}`);
  const userRecord = await admin.auth().getUser(userId);

  // Using 'testing' customer type for sandbox environments.
  const response = await fetch(`${FINICITY_API_BASE_URL}/aggregation/v2/customers/testing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Finicity-App-Key": FINICITY_APP_KEY as string, // Type assertion
      "Finicity-App-Token": token,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      username: userRecord.email || `verza-user-${userId}`, // Finicity requires a unique username
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
  logger.info(`Saved new Finicity customer ID ${finicityCustomerId} for user ${userId}`);

  return finicityCustomerId;
}

/**
 * Generates a Finicity Connect URL for a user.
 * @param {string} userId - The ID of the user for whom the Connect URL is being generated.
 * @param {string} token - The Finicity API authentication token.
 * Callable function to generate a Finicity Connect URL.
 */
export const generateFinicityConnectUrl = onCall({
  enforceAppCheck: false, // Adjust as per your security requirements
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
      logger.error("The APP_URL environment variable is not set for the 'generateFinicityConnectUrl' function.");
      throw new HttpsError(
        "failed-precondition",
        "The application's base URL (APP_URL) is not configured on the server."
      );
    }

    const webhookUrl = process.env.FINICITY_WEBHOOK_URL;
    if (!webhookUrl) {
      logger.error("The FINICITY_WEBHOOK_URL environment variable is not set.");
      throw new HttpsError(
        "failed-precondition",
        "The Finicity webhook URL is not configured on the server."
      );
    }


    logger.info("Generating Finicity Connect URL...");
    const response = await fetch(`${FINICITY_API_BASE_URL}/connect/v2/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Finicity-App-Key": FINICITY_APP_KEY as string, // Type assertion
        "Finicity-App-Token": token,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        partnerId: FINICITY_PARTNER_ID,
        customerId: finicityCustomerId,
        redirectUri: `${appUrl}/banking`, // Where to redirect after success/cancel
        webhook: webhookUrl,
        webhookContentType: "application/json",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error("Failed to generate Finicity Connect URL:", {status: response.status, body: errorBody});
      throw new HttpsError("internal", "Could not generate Finicity Connect URL.");
    }

    const data = await response.json();
    logger.info("Successfully generated Finicity Connect URL.");
    return {connectUrl: data.link};
  } catch (error) {
    logger.error("Error in generateFinicityConnectUrl:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An unexpected error occurred while setting up bank connection.");
  }
});


/**
 * Webhook handler for Finicity events.
 */
export const finicityWebhookHandler = onRequest(async (request, response) => {
  logger.info("Finicity webhook received a request.", {body: request.body});

  // TODO: Implement webhook event processing
  // - Verify the signature (if Finicity provides one)
  // - Parse the event type (e.g., account added, transactions discovered)
  // - If it's an account aggregation success event, queue a job to fetch accounts and transactions
  // - Save data to Firestore under the correct user (e.g., using customerId from event)

  response.status(204).send(); // Acknowledge receipt of the event
});
