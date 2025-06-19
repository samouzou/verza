
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as DropboxSign from "@dropbox/sign"; // Updated import
import type {Contract} from "../../../src/types";

const HELLOSIGN_API_KEY = process.env.HELLOSIGN_API_KEY; // Still using this env var name for consistency with apphosting.yaml

let signatureRequestApi: DropboxSign.SignatureRequestApi | null = null;

if (HELLOSIGN_API_KEY) {
  signatureRequestApi = new DropboxSign.SignatureRequestApi();
  signatureRequestApi.username = HELLOSIGN_API_KEY; // Set API key
} else {
  logger.warn("HELLOSIGN_API_KEY (for Dropbox Sign) is not set. E-signature functionality will not work.");
}

/**
 * Verifies the Firebase ID token from the Authorization header in callable functions
 * @param {string | undefined} uid - The UID from request.auth.uid
 * @return {Promise<string>} The user ID if the token is valid
 * @throws {Error} If the token is missing or invalid
 */
async function verifyAuth(uid: string | undefined): Promise<string> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  try {
    await admin.auth().getUser(uid);
    return uid;
  } catch (error) {
    logger.error("Error verifying auth UID:", error);
    throw new HttpsError("unauthenticated", "Invalid user credentials.");
  }
}


export const initiateHelloSignRequest = onCall(async (request) => {
  if (!signatureRequestApi) { // Check if the API client is initialized
    logger.error("Dropbox Sign API client not initialized. API key missing or invalid.");
    throw new HttpsError("failed-precondition", "E-signature service is not configured.");
  }

  const userId = await verifyAuth(request.auth?.uid);
  const {contractId, signerEmailOverride} = request.data;

  if (!contractId || typeof contractId !== "string") {
    throw new HttpsError("invalid-argument", "Valid contract ID is required.");
  }

  try {
    const contractDocRef = db.collection("contracts").doc(contractId);
    const contractSnap = await contractDocRef.get();

    if (!contractSnap.exists) {
      throw new HttpsError("not-found", "Contract not found.");
    }

    const contractData = contractSnap.data() as Contract;

    if (contractData.userId !== userId) {
      throw new HttpsError("permission-denied", "You do not have permission to access this contract.");
    }

    if (!contractData.fileUrl) {
      throw new HttpsError("failed-precondition", "Contract document (fileUrl) is missing. Cannot send for signature.");
    }

    const finalSignerEmail = signerEmailOverride || contractData.clientEmail;
    if (!finalSignerEmail) {
      throw new HttpsError("invalid-argument", "Signer email is missing. Please ensure client email is set or provide one.");
    }

    const userRecord = await admin.auth().getUser(userId);
    const creatorEmail = userRecord.email;
    if (!creatorEmail) {
      throw new HttpsError("failed-precondition", "Creator email not found. Cannot send signature request.");
    }

    const options: DropboxSign.SignatureRequestSendRequest = {
      testMode: true, // equivalent to test_mode: 1
      title: contractData.projectName || `Contract with ${contractData.brand}`,
      subject: `Signature Request: ${contractData.projectName || `Contract for ${contractData.brand}`}`,
      message: `Hello ${contractData.clientName || "Client"}, 
        please review and sign the attached contract regarding ${contractData.projectName || contractData.brand}.`,
      signers: [
        {
          emailAddress: finalSignerEmail,
          name: contractData.clientName || "Client Signer",
          // order: 0, // Optional
        },
        // Optional: Add creator as a signer if needed
        // {
        //   emailAddress: creatorEmail,
        //   name: userRecord.displayName || "Creator",
        //   order: 1,
        // }
      ],
      // ccEmailAddresses: [creatorEmail],
      fileUrls: [contractData.fileUrl], // SDK expects array of strings for fileUrl
      metadata: {
        contract_id: contractId,
        user_id: userId,
        verza_env: process.env.NODE_ENV || "development",
      },
      // useTextTags: true, // If you use text tags
      // hideTextTags: true,
    };

    logger.info("Sending Dropbox Sign request with options:", JSON.stringify({
      // Redact sensitive information for logging
      ...options,
      signers: options.signers ? options.signers.map((s) => ({name: s.name, emailAddress: "[REDACTED]"})) : undefined,
      ccEmailAddresses: options.ccEmailAddresses ? options.ccEmailAddresses.map(() => "[REDACTED]") : undefined,
      fileUrls: options.fileUrls ? options.fileUrls.map(() => "[REDACTED_URL]") : undefined,
    }));

    // Send the signature request
    const response = await signatureRequestApi.signatureRequestSend(options); // Updated method call
    const signatureRequestId = response.body.signatureRequest?.signatureRequestId;

    if (!signatureRequestId) {
      logger.error("Dropbox Sign response missing signature_request_id", response);
      throw new HttpsError("internal", "Failed to get signature request ID from Dropbox Sign.");
    }

    await contractDocRef.update({
      helloSignRequestId: signatureRequestId,
      signatureStatus: "sent",
      lastSignatureEventAt: admin.firestore.FieldValue.serverTimestamp(),
      invoiceHistory: admin.firestore.FieldValue.arrayUnion({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        action: "E-Signature Request Sent (Dropbox Sign)",
        details: `To: ${finalSignerEmail}. Dropbox Sign ID: ${signatureRequestId}`,
      }),
    });

    logger.info(`Dropbox Sign request ${signatureRequestId} sent for contract ${contractId}.`);
    return {
      success: true,
      message: `Signature request sent to ${finalSignerEmail} via Dropbox Sign.`,
      helloSignRequestId: signatureRequestId,
    };
  } catch (error: any) {
    logger.error(`Error initiating Dropbox Sign request for contract ${contractId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }

    // Dropbox Sign SDK errors often come in error.body or error.response
    const errorMessage = error.body?.error?.errorMsg || error.response?.body?.error?.errorMsg ||
      error.message || "An unknown error occurred.";

    if (error.code === "ECONNREFUSED" || (error.response && error.response.statusCode === 401)) {
      throw new HttpsError("unauthenticated", "Dropbox Sign API key is invalid or missing, or network issue.");
    }
    if (error.response && error.response.statusCode === 400) { // Bad Request
      throw new HttpsError("invalid-argument", `Dropbox Sign error: ${errorMessage}`);
    }

    throw new HttpsError("internal", errorMessage);
  }
});
