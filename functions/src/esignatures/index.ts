
import {onCall, HttpsError, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as DropboxSign from "@dropbox/sign";
import type {Contract} from "../../../src/types";
import * as crypto from "crypto";
import type {Timestamp as ClientTimestamp} from "firebase/firestore";


const HELLOSIGN_API_KEY = process.env.HELLOSIGN_API_KEY;

let signatureRequestApi: DropboxSign.SignatureRequestApi | null = null;

if (HELLOSIGN_API_KEY) {
  signatureRequestApi = new DropboxSign.SignatureRequestApi();
  signatureRequestApi.username = HELLOSIGN_API_KEY;
} else {
  logger.warn("HELLOSIGN_API_KEY (for Dropbox Sign) is not set. E-signature functionality will not work.");
}

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
  if (!signatureRequestApi) {
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
      testMode: true,
      title: contractData.projectName || `Contract with ${contractData.brand}`,
      subject: `Signature Request: ${contractData.projectName || `Contract for ${contractData.brand}`}`,
      message: `
        Hello ${contractData.clientName || "Client"},
        Please review and sign the attached contract regarding ${contractData.projectName || contractData.brand}.`,
      signers: [
        {
          emailAddress: finalSignerEmail,
          name: contractData.clientName || "Client Signer",
        },
      ],
      fileUrls: [contractData.fileUrl],
      metadata: {
        contract_id: contractId,
        user_id: userId,
        verza_env: process.env.NODE_ENV || "development",
      },
    };

    logger.info("Sending Dropbox Sign request with options:", JSON.stringify({
      ...options,
      signers: options.signers ? options.signers.map((s) => ({name: s.name, emailAddress: "[REDACTED]"})) : undefined,
      fileUrls: options.fileUrls ? options.fileUrls.map(() => "[REDACTED_URL]") : undefined,
    }));

    const response = await signatureRequestApi.signatureRequestSend(options);
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
    const errorMessage = error.body?.error?.errorMsg || error.response?.body?.error?.errorMsg ||
      error.message || "An unknown error occurred.";
    if (error.code === "ECONNREFUSED" || (error.response && error.response.statusCode === 401)) {
      throw new HttpsError("unauthenticated", "Dropbox Sign API key is invalid or missing, or network issue.");
    }
    if (error.response && error.response.statusCode === 400) {
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

  let actualEventPayload: any = null; // Initialize to null

  if (request.body && typeof request.body.json === 'string') {
    try {
      actualEventPayload = JSON.parse(request.body.json);
    } catch (e: any) {
      logger.error("Failed to parse request.body.json:", e.message, "Content:", request.body.json);
      response.status(400).send("Invalid JSON in 'json' parameter.");
      return;
    }
  } else if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    actualEventPayload = request.body;
  } else if (Buffer.isBuffer(request.body)) {
    // If it's a buffer, we can't reliably parse it here without more info or a specific parser.
    // Log it, but actualEventPayload will remain null, letting subsequent checks handle it.
    logger.warn("Received raw buffer for webhook body. This might be a malformed test or an unhandled Content-Type. Body (partial):", request.body.toString('utf8', 0, 200));
  }

  // Check if actualEventPayload was successfully parsed into an object AND it's a test event
  if (actualEventPayload && typeof actualEventPayload === 'object' && actualEventPayload.event && actualEventPayload.event.event_type === "test") {
    logger.info("Received Dropbox Sign test event. Responding with 200 OK.");
    response.status(200).send("Hello API Event Received");
    return;
  }

  // If actualEventPayload is still null or not an object here, it means parsing failed or body was an unhandled buffer/empty.
  if (!actualEventPayload || typeof actualEventPayload !== 'object') {
    logger.error("Webhook payload could not be successfully parsed into an object or was empty/unrecognized.", {originalBodyRequestType: typeof request.body, isBuffer: Buffer.isBuffer(request.body)});
    response.status(400).send("Invalid payload format or content. Ensure 'json' parameter is used for form data or Content-Type is application/json.");
    return;
  }

  // Regular event processing continues here, actualEventPayload is a parsed object.
  if (!process.env.HELLOSIGN_API_KEY) {
    logger.error("HELLOSIGN_API_KEY is not configured. Cannot verify webhook.");
    response.status(500).send("Webhook not configured.");
    return;
  }

  try {
    const eventData = actualEventPayload.event;
    const signatureRequestData = actualEventPayload.signature_request;

    if (!eventData || typeof eventData !== 'object' || !eventData.event_time || !eventData.event_type || !eventData.event_hash) {
      logger.error("Invalid webhook payload: Missing essential event data fields (event_time, event_type, event_hash) in parsed payload.", actualEventPayload);
      response.status(400).send("Invalid payload: missing required event data fields.");
      return;
    }

    const {event_time: eventTime, event_type: eventType, event_hash: receivedHash} = eventData;
    const computedHash = crypto
      .createHmac("sha256", process.env.HELLOSIGN_API_KEY)
      .update(eventTime + eventType)
      .digest("hex");

    if (computedHash !== receivedHash) {
      logger.warn("Webhook event hash mismatch. Potential tampering or misconfiguration.", {receivedHash, computedHash});
      response.status(403).send("Invalid signature.");
      return;
    }

    logger.info(`Received verified Dropbox Sign event: ${eventType}`, { eventMetadata: eventData.event_metadata });

    const signatureRequestId = signatureRequestData?.signature_request_id;
    if (!signatureRequestId && eventType !== "account_callback_test") { // Allow account_callback_test to pass without sig req id
        if (eventData.event_metadata && eventData.event_metadata.reported_for_account_id) {
            logger.info(`Received account-level callback: ${eventType}. No signature_request_id expected.`);
            // Handle account-level events here if needed in the future, e.g., app deauthorized.
            // For now, we just acknowledge them if they pass hash verification.
            response.status(200).send("Hello API Event Received");
            return;
        }
        logger.error("Webhook payload missing signature_request_id for a non-account event.", signatureRequestData);
        response.status(200).send("Hello API Event Received"); // Acknowledge, but log error.
        return;
    }
    
    if (!signatureRequestId && eventType.startsWith("signature_request_")) {
        logger.error("Webhook payload missing signature_request_id for a signature_request event.", signatureRequestData);
        response.status(200).send("Hello API Event Received");
        return;
    }


    if (signatureRequestId) {
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
        case "signature_request_signed": // A signer completed their part
          // is_complete flag tells if ALL signers have signed.
          if (signatureRequestData?.is_complete) {
            newStatus = "signed"; // All signed
            historyAction = "Document Fully Signed (Dropbox Sign)";
            if (signatureRequestData.files_url) { // Temporary URL to download signed PDF
              signedDocumentUrl = signatureRequestData.files_url;
            }
          } else {
            // Not all signed yet, status remains 'sent' or could be 'viewed_by_signer'
            // You might add a specific status like 'partially_signed' if your flow needs it
            logger.info(`Signature received for ${signatureRequestId}, but not all signed yet.`);
            historyAction = `Signer Action: ${eventType} (Pending others)`;
            // Keep newStatus as is, or update based on other logic.
            // For simplicity, if not all signed, the overall status might remain "sent" or "viewed_by_signer"
            // until "signature_request_all_signed" or is_complete on a signed event.
          }
          break;
        case "signature_request_all_signed": // All signers have completed
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
          logger.info(`Unhandled Dropbox Sign event type specific to signature requests: ${eventType}`);
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
    } else if (eventType !== "account_callback_test" && !eventData.event_metadata?.reported_for_account_id) {
        // This case should ideally not be reached if signatureRequestId is missing for signature_request_* events.
        logger.warn(`Received event type ${eventType} without a signatureRequestId and it's not an account callback test or known account event.`);
    }


    response.status(200).send("Hello API Event Received");
  } catch (error) {
    logger.error("Error processing Dropbox Sign webhook:", error);
    if (!response.headersSent) {
      response.status(500).send("Error processing webhook.");
    }
  }
});

