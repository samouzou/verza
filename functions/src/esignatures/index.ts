
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

/**
 * Verifies the Firebase user ID (UID) for authenticated callable functions.
 * Ensures the function is called by an authenticated user and the UID is valid.
 * @param {string | undefined} uid The user ID from the callable function request context (request.auth.uid).
 * @return {Promise<string>} A Promise that resolves with the user ID if authentication is successful.
 * @throws {HttpsError} If the user is not authenticated or the UID is invalid.
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
      signers: options.signers ? options.signers.map((s: any) => ({name: s.name, emailAddress: "[REDACTED]"})) : undefined,
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

  let actualEventPayload: any = null;

  if (request.body && typeof request.body.json === "string") {
    try {
      actualEventPayload = JSON.parse(request.body.json);
      logger.info("Webhook payload parsed from request.body.json (form-urlencoded).");
    } catch (e: any) {
      logger.error("Failed to parse request.body.json:", e.message, "Content:", request.body.json);
    }
  } else if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    actualEventPayload = request.body;
    logger.info("Webhook payload used directly from request.body (likely application/json).");
  } else if (Buffer.isBuffer(request.body)) {
    const bodyString = request.body.toString("utf8");
    try {
      actualEventPayload = JSON.parse(bodyString);
      logger.info("Webhook payload parsed from raw Buffer body (utf8 string to JSON).");
    } catch (e) {
      logger.warn("Request body is a Buffer and could not be parsed as JSON. This might be complex multipart data or binary. Body (partial):", bodyString.substring(0, 250));
    }
  }

  // Check if it's ANY kind of test event after successful parsing
  if (actualEventPayload && typeof actualEventPayload === 'object' && actualEventPayload.event && typeof actualEventPayload.event.event_type === 'string' &&
      (actualEventPayload.event.event_type === "test" || actualEventPayload.event.event_type.endsWith("_test"))
     ) {
    logger.info(`Received Dropbox Sign test event: ${actualEventPayload.event.event_type}. Responding with 200 OK.`, actualEventPayload);
    response.status(200).send("Hello API Event Received");
    return;
  }

  if (!actualEventPayload || typeof actualEventPayload !== "object") {
    logger.error("Webhook payload could not be successfully parsed into a usable object or was empty/unrecognized.", {
      originalBodyType: typeof request.body,
      isBuffer: Buffer.isBuffer(request.body),
      contentType: request.headers["content-type"] || "N/A",
      bodyPreview: Buffer.isBuffer(request.body) ? request.body.toString("utf8", 0, 250) : (typeof request.body === "string" ?
        request.body.substring(0, 250) : "Non-string/buffer body"),
    });
    response.status(400).send("Invalid payload format or content.");
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

    if (!eventData || typeof eventData !== "object" || !eventData.event_time ||
      !eventData.event_type || !eventData.event_hash) {
      logger.error("Invalid webhook payload: Missing essential event data fields (event_time, event_type, event_hash) in parsed payload.", actualEventPayload);
      response.status(400).send("Invalid payload: missing required event data fields.");
      return;
    }

    const {event_time: eventTime, event_type: eventType, event_hash: receivedHash} = eventData;
    const computedHash = crypto
      .createHmac("sha256", HELLOSIGN_API_KEY)
      .update(eventTime + eventType)
      .digest("hex");

    if (computedHash !== receivedHash) {
      logger.warn("Webhook event hash mismatch. Potential tampering or misconfiguration.", {receivedHash, computedHash});
      response.status(403).send("Invalid signature.");
      return;
    }

    logger.info(`Received verified Dropbox Sign event: ${eventType}`, {eventMetadata: eventData.event_metadata});

    const signatureRequestId = signatureRequestData?.signature_request_id;

    if (!signatureRequestId && eventData.event_metadata?.reported_for_account_id) {
      logger.info(`Received account-level callback: ${eventType}. No signature_request_id expected or needed for this type.`);
      response.status(200).send("Hello API Event Received");
      return;
    }

    if (eventType.startsWith("signature_request_") && !signatureRequestId) {
      logger.error("Webhook payload missing signature_request_id for a signature_request event.", signatureRequestData);
      response.status(200).send("Hello API Event Received (Error Logged)"); // Acknowledge but log
      return;
    }


    if (signatureRequestId) {
      const contractsRef = db.collection("contracts");
      const q = contractsRef.where("helloSignRequestId", "==", signatureRequestId).limit(1);
      const contractSnapshot = await q.get();

      if (contractSnapshot.empty) {
        logger.warn(`No contract found for helloSignRequestId: ${signatureRequestId}`);
        response.status(200).send("Hello API Event Received"); // Acknowledge
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
          historyAction = "Document Fully Signed (Dropbox Sign)";
          if (signatureRequestData.files_url) {
            signedDocumentUrl = signatureRequestData.files_url;
          }
        } else {
          logger.info(`Signature received for ${signatureRequestId}, but not all signed yet.`);
          historyAction = `Signer Action: ${eventType} (Pending others)`;
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
        logger.info(`Unhandled Dropbox Sign event type specific to signature requests: ${eventType}`);
        response.status(200).send("Hello API Event Received"); // Acknowledge unhandled but valid events
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
    } else if (eventType !== "account_callback_test" && !eventData.event_metadata?.reported_for_account_id) { // Updated this condition
      logger.warn(`Received event type ${eventType} without a signatureRequestId
        and it's not a known account event or specific test.`);
    }


    response.status(200).send("Hello API Event Received");
  } catch (error) {
    logger.error("Error processing Dropbox Sign webhook:", error);
    if (!response.headersSent) {
      response.status(500).send("Error processing webhook.");
    }
  }
});

    

    