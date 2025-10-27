
import {onCall, HttpsError, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import * as DropboxSign from "@dropbox/sign";
import type {Contract, UserProfileFirestoreData} from "../../../src/types";
import * as crypto from "crypto";
import type {Timestamp as ClientTimestamp} from "firebase/firestore";
import axios from "axios";
import FormData from "form-data";
import { PdfDocument, PdfPageOrientation, PdfPageSettings, PdfSection, SizeF } from "@syncfusion/ej2-pdf-export";
import { WordProcessor, DocumentHelper } from "@syncfusion/ej2-file-utils";

const HELLOSIGN_API_KEY = process.env.HELLOSIGN_API_KEY;

if (HELLOSIGN_API_KEY) {
  // We keep this for type reference but will use axios for the actual call
  new DropboxSign.SignatureRequestApi().username = HELLOSIGN_API_KEY;
} else {
  logger.warn("HELLOSIGN_API_KEY (for Dropbox Sign) is not set. E-signature functionality will not work.");
}

/**
 * Verifies that a user is authenticated via their UID.
 * @param {string | undefined} uid The user's ID from the request auth context.
 * @return {Promise<string>} A promise that resolves with the UID if valid.
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
  if (!HELLOSIGN_API_KEY) {
    logger.error("Dropbox Sign API client not initialized. API key missing or invalid.");
    throw new HttpsError("failed-precondition", "E-signature service is not configured.");
  }

  const requesterId = await verifyAuth(request.auth?.uid);
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

    const requesterDoc = await db.collection("users").doc(requesterId).get();
    const requesterData = requesterDoc.data() as UserProfileFirestoreData;
    const agencyId = requesterData.agencyMemberships?.find((m) => m.role === "owner")?.agencyId;

    const isDirectOwner = contractData.userId === requesterId;
    const isAgencyOwner = requesterData.role === "agency_owner" &&
      contractData.ownerType === "agency" && contractData.ownerId === agencyId;

    if (!isDirectOwner && !isAgencyOwner) {
      throw new HttpsError("permission-denied", "You do not have permission to access this contract.");
    }

    const formData = new FormData();
    const API_ENDPOINT = "https://api.hellosign.com/v3/signature_request/send";

    if (contractData.contractText) {
      logger.info(`Generating PDF from SFDT for contract ${contractId}.`);

      const document: DocumentHelper = new DocumentHelper();
      const pageSettings: PdfPageSettings = new PdfPageSettings();
      pageSettings.orientation = PdfPageOrientation.Portrait;
      const section: PdfSection = document.addSection();
      section.pageSettings = pageSettings;
      document.wordProcessor = new WordProcessor(section);

      await document.wordProcessor.deserialize(contractData.contractText);

      const pdfDocument: PdfDocument = new PdfDocument();
      await document.saveAsPdf(pdfDocument, new SizeF(pdfDocument.pageSettings.width, pdfDocument.pageSettings.height));
      const pdfBuffer = Buffer.from(await pdfDocument.save(), 'base64');
      
      formData.append("file[0]", pdfBuffer, {
        filename: `contract-${contractId}.pdf`,
        contentType: "application/pdf",
      });

    } else if (contractData.fileUrl) {
      logger.info(`Using existing fileUrl for contract ${contractId}.`);
      formData.append("file_url[0]", contractData.fileUrl);
    } else {
      throw new HttpsError("failed-precondition", "Contract has no text or file to send for signature.");
    }

    const finalSignerEmail = signerEmailOverride || contractData.clientEmail;
    if (!finalSignerEmail) {
      throw new HttpsError("invalid-argument", "Signer email is missing. Please ensure client email is set or provide one.");
    }

    const creatorUserId = contractData.userId;
    const creatorUserRecord = await admin.auth().getUser(creatorUserId);
    const creatorEmail = creatorUserRecord.email;
    if (!creatorEmail) {
      throw new HttpsError("failed-precondition", "Creator's email not found. Cannot send signature request.");
    }

    const creatorUserDoc = await db.collection("users").doc(creatorUserId).get();
    const creatorUserData = creatorUserDoc.data() as UserProfileFirestoreData;
    if (!creatorUserData) {
      throw new HttpsError("failed-precondition", "Creator's display name not found. Cannot send signature request.");
    }

    // Convert complex objects to JSON strings or simple values for form-data
    const metadata = JSON.stringify({
      contract_id: contractId,
      user_id: creatorUserId,
      verza_env: process.env.NODE_ENV || "development",
    });

    const signers = JSON.stringify([
      {
        email_address: finalSignerEmail,
        name: contractData.clientName || "Client Signer",
        order: 0, // Explicitly set order if needed
      },
      {
        email_address: creatorEmail,
        name: creatorUserData.displayName || "Creator Signer",
        order: 1, // Explicitly set order if needed
      },
    ]);

    // Append all options required by the Dropbox Sign API to the form data
    formData.append("test_mode", "1"); // Equivalent to options.testMode: true
    formData.append("title", contractData.projectName || `Contract with ${contractData.brand}`);
    formData.append("subject", contractData.projectName || `Contract for ${contractData.brand}`);
    formData.append("message", `Hello,\n\nPlease review and sign the attached contract regarding ${contractData.projectName ||
      contractData.brand}.\n\nThank you,\n${creatorUserData.displayName || "The Contract Sender"}`);
    formData.append("signers", signers); // Sending signers array as JSON string
    formData.append("metadata", metadata); // Sending metadata object as JSON string

    if (isAgencyOwner && requesterData.email) {
      formData.append("cc_email_addresses", JSON.stringify([requesterData.email!]));
      // Note: Message needs to be updated before appending if necessary
    }

    logger.info("Sending Dropbox Sign request using FormData via Axios.");

    const response = await axios.post(
      API_ENDPOINT,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          "Authorization": `Basic ${Buffer.from(HELLOSIGN_API_KEY + ":").toString("base64")}`,
        },
        auth: {
          username: HELLOSIGN_API_KEY,
          password: "",
        },
      }
    );

    const responseData = response.data;
    const signatureRequestId = responseData.signature_request?.signature_request_id;

    if (!signatureRequestId) {
      logger.error("Dropbox Sign response missing signature_request_id", responseData);
      throw new HttpsError("internal", "Failed to get signature request ID from Dropbox Sign.");
    }

    await contractDocRef.update({
      helloSignRequestId: signatureRequestId,
      signatureStatus: "sent",
      lastSignatureEventAt: admin.firestore.FieldValue.serverTimestamp(),
      invoiceHistory: admin.firestore.FieldValue.arrayUnion({
        timestamp: admin.firestore.Timestamp.now(),
        action: "E-Signature Request Sent (Dropbox Sign)",
        details: `To Client: ${finalSignerEmail}, To Creator: ${creatorEmail}. Dropbox Sign ID: ${signatureRequestId}`,
      }),
    });

    logger.info(`Dropbox Sign request ${signatureRequestId} sent for contract ${contractId}.`);
    return {
      success: true,
      message: `Signature request sent to ${finalSignerEmail} and ${creatorEmail} via Dropbox Sign.`,
      helloSignRequestId: signatureRequestId,
    };
  } catch (error: any) {
    logger.error(`Error initiating Dropbox Sign request for contract ${contractId}:`, error);

    let errorMessage = "An unknown error occurred.";
    if (axios.isAxiosError(error)) {
      errorMessage = error.response?.data?.error?.error_msg || error.message;
      if (error.response?.status === 401) {
        throw new HttpsError("unauthenticated", "Dropbox Sign API key is invalid or missing, or network issue.");
      }
      if (error.response?.status === 400) {
        throw new HttpsError("invalid-argument", `Dropbox Sign error: ${errorMessage}`);
      }
    } else if (error instanceof HttpsError) {
      throw error;
    } else {
      errorMessage = error.message;
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
  const contentType = request.headers["content-type"] || "";

  if (contentType.startsWith("application/json") && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    actualEventPayload = request.body;
    logger.info("Webhook payload used directly from request.body (application/json).");
  } else if (contentType.startsWith("application/x-www-form-urlencoded") && typeof request.body === "object" &&
  typeof request.body.json === "string") {
    try {
      actualEventPayload = JSON.parse(request.body.json);
      logger.info("Webhook payload parsed from request.body.json (application/x-www-form-urlencoded).");
    } catch (e: any) {
      logger.error("Failed to parse request.body.json from form-urlencoded:", e.message, "Content:", request.body.json);
    }
  } else if (contentType.startsWith("multipart/form-data") && Buffer.isBuffer(request.body)) {
    logger.info("Multipart/form-data detected. Attempting to extract 'json' field.");
    const bodyString = request.body.toString("utf8");
    const boundaryHeader = contentType.split("boundary=")[1];

    if (boundaryHeader) {
      const boundary = `--${boundaryHeader}`;
      const parts = bodyString.split(boundary);

      for (const part of parts) {
        if (part.includes("Content-Disposition: form-data; name=\"json\"")) {
          const headerEndMatch = part.match(/(\r\n\r\n|\n\n)/);
          if (headerEndMatch && headerEndMatch.index !== undefined) {
            const jsonContentStartIndex = headerEndMatch.index + headerEndMatch[0].length;
            let jsonStr = part.substring(jsonContentStartIndex).trim();
            if (jsonStr.endsWith("\r\n")) {
              jsonStr = jsonStr.slice(0, -2);
            } else if (jsonStr.endsWith("\n")) {
              jsonStr = jsonStr.slice(0, -1);
            }
            try {
              actualEventPayload = JSON.parse(jsonStr);
              logger.info("Successfully parsed 'json' field from multipart/form-data. Length:", jsonStr.length);
              break;
            } catch (e: any) {
              logger.error("Failed to parse JSON from extracted 'json' multipart field:", {
                errorMessage: e.message,
                extractedStringStart: jsonStr.substring(0, 200),
                extractedStringEnd: jsonStr.substring(Math.max(0, jsonStr.length - 200)),
              });
            }
          }
        }
      }
      if (!actualEventPayload) {
        logger.warn("Could not find or parse 'json' field in multipart/form-data body after splitting by boundary.");
      }
    } else {
      logger.warn("Multipart/form-data but boundary not found in Content-Type header.");
    }
  } else if (Buffer.isBuffer(request.body)) {
    const bodyString = request.body.toString("utf8");
    logger.info("Raw buffer body received (not handled by specific content type logic)," +
      "attempting direct JSON parse. Length:", bodyString.length);
    try {
      actualEventPayload = JSON.parse(bodyString);
      logger.info("Webhook payload parsed from raw Buffer body (direct JSON parse).");
    } catch (e) {
      logger.warn("Request body is a Buffer (unknown type) and could not be parsed as JSON directly. Body (partial):",
        bodyString.substring(0, 250));
    }
  }

  if (actualEventPayload && typeof actualEventPayload === "object" && actualEventPayload.event &&
    typeof actualEventPayload.event.event_type === "string" &&
      (actualEventPayload.event.event_type === "test" ||
        actualEventPayload.event.event_type.endsWith("_test"))
  ) {
    logger.info(`Received Dropbox Sign test event: ${actualEventPayload.event.event_type}. Responding with 200 OK.`,
      actualEventPayload);
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
      logger.error("Invalid webhook payload: Missing essential event data fields (event_time, event_type, event_hash)" +
        "in parsed payload.", actualEventPayload);
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
    } else if (eventType !== "account_callback_test" &&
      !eventData.event_metadata?.reported_for_account_id) {
      logger.warn(`Received event type ${eventType} without a signatureRequestId and it's not a known 
        account event or specific test.`);
    }

    response.status(200).send("Hello API Event Received");
  } catch (error) {
    logger.error("Error processing Dropbox Sign webhook:", error);
    if (!response.headersSent) {
      response.status(500).send("Error processing webhook.");
    }
  }
});
