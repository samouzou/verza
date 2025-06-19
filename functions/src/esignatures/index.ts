
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import HelloSignSDK from "hellosign-sdk";
import type {Contract} from "../../../src/types"; // Adjusted path if types are in root src

const HELLOSIGN_API_KEY = process.env.HELLOSIGN_API_KEY;

if (!HELLOSIGN_API_KEY) {
  logger.warn("HELLOSIGN_API_KEY is not set. E-signature functionality will not work.");
}

const hellosign = HELLOSIGN_API_KEY ?
  new HelloSignSDK({key: HELLOSIGN_API_KEY}) :
  null;

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
    // Optional: Verify user exists in Firebase Auth if needed, but uid implies it
    await admin.auth().getUser(uid);
    return uid;
  } catch (error) {
    logger.error("Error verifying auth UID:", error);
    throw new HttpsError("unauthenticated", "Invalid user credentials.");
  }
}


export const initiateHelloSignRequest = onCall(async (request) => {
  if (!hellosign) {
    logger.error("HelloSign SDK not initialized. API key missing.");
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

    const options: HelloSignSDK.SignatureRequestSendRequest = {
      test_mode: 1, // Set to 0 for live requests
      title: contractData.projectName || `Contract with ${contractData.brand}`,
      subject: `Signature Request: ${contractData.projectName || `Contract for ${contractData.brand}`}`,
      message: `Hello ${contractData.clientName || "Client"}, please review and sign the attached contract regarding ${contractData.projectName || contractData.brand}.`,
      signers: [
        {
          email_address: finalSignerEmail,
          name: contractData.clientName || "Client Signer",
          // order: 0, // Optional: if multiple signers
        },
        // Optional: Add creator as a signer if needed
        // {
        //   email_address: creatorEmail,
        //   name: userRecord.displayName || "Creator",
        //   order: 1,
        // }
      ],
      // cc_email_addresses: [creatorEmail], // CC the creator
      file_urls: [contractData.fileUrl],
      metadata: {
        contract_id: contractId, // Note: HelloSign converts metadata keys to lowercase with underscores
        user_id: userId,
        verza_env: process.env.NODE_ENV || "development",
      },
      // use_text_tags: 1, // If you use text tags in your document
      // hide_text_tags: 1,
    };

    logger.info("Sending HelloSign request with options:", JSON.stringify({
      ...options,
      // Redact sensitive parts for logging if necessary
      signers: options.signers.map(s => ({name: s.name, email_address: "[REDACTED]"})),
    }));

    const response = await hellosign.signatureRequest.send(options);
    const signatureRequestId = response.signature_request?.signature_request_id;

    if (!signatureRequestId) {
      logger.error("HelloSign response missing signature_request_id", response);
      throw new HttpsError("internal", "Failed to get signature request ID from HelloSign.");
    }

    // Update Firestore contract
    await contractDocRef.update({
      helloSignRequestId: signatureRequestId,
      signatureStatus: "sent",
      lastSignatureEventAt: admin.firestore.FieldValue.serverTimestamp(),
      // Add to invoiceHistory or a new signatureHistory field
      invoiceHistory: admin.firestore.FieldValue.arrayUnion({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        action: "E-Signature Request Sent",
        details: `To: ${finalSignerEmail}. HelloSign ID: ${signatureRequestId}`,
      }),
    });

    logger.info(`Signature request ${signatureRequestId} sent for contract ${contractId}.`);
    return {
      success: true,
      message: `Signature request sent to ${finalSignerEmail}.`,
      helloSignRequestId: signatureRequestId,
    };

  } catch (error: any) {
    logger.error(`Error initiating HelloSign request for contract ${contractId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    // Check for HelloSign specific errors
    if (error.type === "HSAuthenticationError") {
        throw new HttpsError("unauthenticated", "HelloSign API key is invalid or missing.");
    }
    if (error.type === "HSInvalidRequestError" && error.message) {
         throw new HttpsError("invalid-argument", `HelloSign error: ${error.message}`);
    }
    throw new HttpsError("internal", error.message || "An unknown error occurred while initiating the signature request.");
  }
});
