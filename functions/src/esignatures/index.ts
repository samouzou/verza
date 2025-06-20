
import {onCall, HttpsError, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as DropboxSign from "@dropbox/sign"; // Updated import
import type {Contract} from "../../../src/types";
import * as crypto from "crypto";
import type {Timestamp as ClientTimestamp} from "firebase/firestore"; // For casting target


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
      message: `
        Hello ${contractData.clientName || "Client"},
        Please review and sign the attached contract regarding ${contractData.projectName || contractData.brand}.`,
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
        contract_id: contractId, // Ensure metadata keys are strings
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
      ccEmailAddresses: options.ccEmailAddresses ?
        options.ccEmailAddresses.map(() => "[REDACTED]") :
        undefined,
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
        timestamp: admin.firestore.Timestamp.now(),
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


export const helloSignWebhookHandler = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    logger.warn("Received non-POST request to webhook.");
    response.status(405).send("Method Not Allowed");
    return;
  }

  let actualEventPayload: any;

  // Dropbox Sign often sends payload in a 'json' field for form-urlencoded or multipart.
  // Firebase Gen2 onRequest will parse application/x-www-form-urlencoded into request.body.
  if (request.body && typeof request.body.json === 'string') {
    try {
      actualEventPayload = JSON.parse(request.body.json);
    } catch (e) {
      logger.error("Failed to parse request.body.json:", e, "Content:", request.body.json);
      response.status(400).send("Invalid JSON in 'json' parameter.");
      return;
    }
  } else if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    // If Content-Type was application/json, Firebase parses it directly into request.body.
    actualEventPayload = request.body;
  } else if (Buffer.isBuffer(request.body)) {
    // If it's a buffer, it might be multipart/form-data not handled by Firebase's parser,
    // or some other content type. For Dropbox Sign, we still expect a 'json' field.
    // This specific case might need a multipart parser if files were attached WITH the event,
    // but typically event data is in the 'json' field.
    logger.error("Request body is a Buffer and was not automatically parsed. This is unexpected for typical Dropbox Sign webhooks unless it's a direct file post without a 'json' field. Body (partial):", request.body.toString('utf8', 0, 200));
    response.status(400).send("Raw buffer received. Expected parsed JSON or form data with a 'json' field.");
    return;
  } else {
    logger.error("Webhook payload is in an unrecognized format or empty.", request.body);
    response.status(400).send("Invalid or empty payload.");
    return;
  }

  // Handle Dropbox Sign's test event using the parsed payload
  if (actualEventPayload.event && actualEventPayload.event.event_type === "test") {
    logger.info("Received Dropbox Sign test event. Responding with 200 OK.");
    response.status(200).send("Hello API Event Received");
    return;
  }

  if (!HELLOSIGN_API_KEY) {
    logger.error("HELLOSIGN_API_KEY is not configured. Cannot verify webhook.");
    response.status(500).send("Webhook not configured.");
    return;
  }

  try {
    const eventData = actualEventPayload.event;
    const signatureRequestData = actualEventPayload.signature_request;

    if (!eventData || !eventData.event_time || !eventData.event_type || !eventData.event_hash) {
      logger.error("Invalid webhook payload: Missing essential event data fields in parsed payload.", actualEventPayload);
      response.status(400).send("Invalid payload: missing event data fields.");
      return;
    }

    // Verify the event hash
    const {event_time: eventTime, event_type: eventType, event_hash: receivedHash} = eventData;
    const computedHash = crypto
      .createHmac("sha256", HELLOSIGN_API_KEY)
      .update(eventTime + eventType)
      .digest("hex");

    if (computedHash !== receivedHash) {
      logger.warn("Webhook event hash mismatch. Potential tampering or misconfiguration.", { receivedHash, computedHash });
      response.status(403).send("Invalid signature.");
      return;
    }

    logger.info(`Received verified Dropbox Sign event: ${eventType}`, eventData);

    const signatureRequestId = signatureRequestData?.signature_request_id;
    if (!signatureRequestId) {
      logger.error("Webhook payload missing signature_request_id.", signatureRequestData);
      response.status(200).send("Hello API Event Received"); // Acknowledge, but log error.
      return;
    }

    const contractsRef = db.collection("contracts");
    const q = contractsRef.where("helloSignRequestId", "==", signatureRequestId).limit(1);
    const contractSnapshot = await q.get();

    if (contractSnapshot.empty) {
      logger.warn(`No contract found for helloSignRequestId: ${signatureRequestId}`);
      response.status(200).send("Hello API Event Received");
      return;
    }

    const contractDocRef = contractSnapshot.docs[0].ref;
    const contractData = contractSnapshot.docs[0].data() as Contract;
    let newStatus: Contract["signatureStatus"] = contractData.signatureStatus;
    let signedDocumentUrl: string | null = contractData.signedDocumentUrl || null;
    let historyAction = `Dropbox Sign Event: ${eventType}`;

    switch (eventType) {
    case "signature_request_viewed":
      newStatus = "viewed_by_signer";
      historyAction = "Document Viewed by Signer (Dropbox Sign)";
      break;
    case "signature_request_signed":
      if (signatureRequestData?.is_complete) {
        newStatus = "signed";
        historyAction = "Document Signed (Dropbox Sign)";
        if (signatureRequestData.files_url) {
          signedDocumentUrl = signatureRequestData.files_url;
        }
      } else {
        logger.info(`Signature received for ${signatureRequestId}, but not all signed yet.`);
      }
      break;
    case "signature_request_all_signed":
      newStatus = "signed";
      historyAction = "Document Fully Signed (Dropbox Sign)";
      if (signatureRequestData?.files_url) {
        signedDocumentUrl = signatureRequestData.files_url;
      }
      break;
    case "signature_request_declined":
      newStatus = "declined";
      historyAction = "Signature Declined by Signer (Dropbox Sign)";
      break;
    case "signature_request_canceled":
      newStatus = "canceled";
      historyAction = "Signature Request Canceled (Dropbox Sign)";
      break;
    case "signature_request_error":
      newStatus = "error";
      historyAction = "Dropbox Sign Error Processing Request";
      logger.error(`Dropbox Sign error event for ${signatureRequestId}:`, signatureRequestData?.error);
      break;
    default:
      logger.info(`Unhandled Dropbox Sign event type: ${eventType}`);
      response.status(200).send("Hello API Event Received");
      return;
    }

    const updates: Partial<Contract> = {
      signatureStatus: newStatus,
      lastSignatureEventAt: admin.firestore.Timestamp.fromDate(new Date(eventTime * 1000)) as unknown as ClientTimestamp,
      invoiceHistory: admin.firestore.FieldValue.arrayUnion({
        timestamp: admin.firestore.Timestamp.now(),
        action: historyAction,
        details: `Dropbox Sign Event: ${eventType}. Request ID: ${signatureRequestId}`,
      }) as any,
    };

    if (signedDocumentUrl && signedDocumentUrl !== contractData.signedDocumentUrl) {
      updates.signedDocumentUrl = signedDocumentUrl;
    }

    await contractDocRef.update(updates);
    logger.info(`Contract ${contractDocRef.id} updated successfully for event ${eventType}.`);

    response.status(200).send("Hello API Event Received");
  } catch (error) {
    logger.error("Error processing Dropbox Sign webhook:", error);
    if (!response.headersSent) {
      response.status(500).send("Error processing webhook.");
    }
  }
});
    