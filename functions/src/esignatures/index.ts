
import {onCall, HttpsError, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
import {DocumentApi, DocumentSigner, FormField, SendForSign} from "boldsign";
import type {Contract, UserProfileFirestoreData} from "./../types";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as params from "../config/params";
import {PDFDocument, StandardFonts, PageSizes, rgb} from "pdf-lib";


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

// Y position of signature fields on the dedicated signature page
const SIGNATURE_Y = 220;

/**
 * Extracts plain text paragraphs from an SFDT JSON string.
 * @param {string} contractText The SFDT JSON string or plain text.
 * @return {string[]} Array of paragraph strings.
 */
function extractParagraphs(contractText: string): string[] {
  try {
    const sfdt = JSON.parse(contractText);
    const sections = sfdt.sections || sfdt.sec || [];
    const paragraphs: string[] = [];
    sections.forEach((section: any) => {
      const blocks = section.blocks || section.b || [];
      blocks.forEach((block: any) => {
        const inlines = block.inlines || block.i || [];
        let para = "";
        inlines.forEach((inline: any) => {
          para += inline.text || inline.tlp || "";
        });
        paragraphs.push(para);
      });
    });
    return paragraphs;
  } catch (e) {
    return contractText.split("\n");
  }
}

/**
 * Generates a PDF buffer from contract text with a dedicated signature page appended.
 * Returns the PDF buffer and the 1-indexed page number of the signature page.
 * @param {string} contractText The SFDT or plain text contract content.
 * @param {string} title Document title shown at the top.
 * @param {string} clientName Name of the client signer.
 * @param {string} creatorName Name of the creator signer.
 * @return {Promise<{buffer: Buffer, signaturePage: number}>} PDF buffer and signature page number.
 */
async function generateContractPdf(
  contractText: string,
  title: string,
  clientName: string,
  creatorName: string,
): Promise<{buffer: Buffer; signaturePage: number}> {
  const [PAGE_W, PAGE_H] = PageSizes.Letter; // 612 x 792
  const MARGIN = 72;
  const CONTENT_W = PAGE_W - 2 * MARGIN;
  const BODY_SIZE = 11;
  const LINE_H = BODY_SIZE * 1.45;

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // pdf-lib origin is bottom-left; y decreases as we move down the page
  let page = pdfDoc.addPage(PageSizes.Letter);
  let y = PAGE_H - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage(PageSizes.Letter);
      y = PAGE_H - MARGIN;
    }
  };

  const drawLine = (text: string, font: typeof regular, size: number, x = MARGIN) => {
    ensureSpace(size * 1.5);
    page.drawText(text, {x, y, size, font, color: rgb(0, 0, 0), maxWidth: CONTENT_W});
    y -= LINE_H;
  };

  // Word-wrap a paragraph into individual lines, then draw each
  const drawParagraph = (text: string, font: typeof regular, size: number) => {
    const words = text.split(" ").filter((w) => w.length > 0);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > CONTENT_W && line) {
        drawLine(line, font, size);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) drawLine(line, font, size);
  };

  // Title
  drawParagraph(title, bold, 16);
  y -= 10;

  // Body
  const paragraphs = extractParagraphs(contractText);
  for (const para of paragraphs) {
    if (para.trim()) {
      drawParagraph(para.trim(), regular, BODY_SIZE);
      y -= 4;
    } else {
      y -= LINE_H * 0.5;
    }
  }

  // ---- Signature page ----
  page = pdfDoc.addPage(PageSizes.Letter);
  const signaturePage = pdfDoc.getPageCount(); // 1-indexed

  // pdf-lib y for the signature field: PAGE_H - SIGNATURE_Y = 792 - 220 = 572 (from bottom)
  const sigLineY = PAGE_H - SIGNATURE_Y; // 572

  // Heading
  const headingText = "SIGNATURES";
  const headingW = bold.widthOfTextAtSize(headingText, 14);
  page.drawText(headingText, {
    x: (PAGE_W - headingW) / 2,
    y: PAGE_H - MARGIN,
    size: 14,
    font: bold,
    color: rgb(0, 0, 0),
  });

  const subText = "By signing below, both parties agree to the terms of this contract.";
  const subW = regular.widthOfTextAtSize(subText, 9);
  page.drawText(subText, {
    x: (PAGE_W - subW) / 2,
    y: PAGE_H - MARGIN - 22,
    size: 9,
    font: regular,
    color: rgb(0.4, 0.4, 0.4),
  });

  // Brand block (left) — label and name sit well above the line so a drawn signature won't overlap
  const leftX = MARGIN;
  page.drawText("Brand", {x: leftX, y: sigLineY + 80, size: 11, font: bold, color: rgb(0, 0, 0)});
  page.drawText(clientName, {x: leftX, y: sigLineY + 62, size: 10, font: regular, color: rgb(0.2, 0.2, 0.2)});
  page.drawLine({start: {x: leftX, y: sigLineY}, end: {x: leftX + 200, y: sigLineY}, thickness: 0.75, color: rgb(0, 0, 0)});
  page.drawText("Signature", {x: leftX, y: sigLineY - 13, size: 8, font: regular, color: rgb(0.5, 0.5, 0.5)});

  // Creator block (right)
  const rightX = 320;
  page.drawText("Creator", {x: rightX, y: sigLineY + 80, size: 11, font: bold, color: rgb(0, 0, 0)});
  page.drawText(creatorName, {x: rightX, y: sigLineY + 62, size: 10, font: regular, color: rgb(0.2, 0.2, 0.2)});
  page.drawLine({start: {x: rightX, y: sigLineY}, end: {x: rightX + 200, y: sigLineY}, thickness: 0.75, color: rgb(0, 0, 0)});
  page.drawText("Signature", {x: rightX, y: sigLineY - 13, size: 8, font: regular, color: rgb(0.5, 0.5, 0.5)});

  const pdfBytes = await pdfDoc.save();
  return {buffer: Buffer.from(pdfBytes), signaturePage};
}

export const initiateBoldSignRequest = onCall(
  {secrets: [params.BOLDSIGN_API_KEY]},
  async (request) => {
    const apiKey = params.BOLDSIGN_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "E-signature service is not configured.");
    }

    const requesterId = await verifyAuth(request.auth?.uid);
    const {contractId, signerEmailOverride} = request.data;

    if (!contractId || typeof contractId !== "string") {
      throw new HttpsError("invalid-argument", "Valid contract ID is required.");
    }

    let tempFilePath: string | null = null;

    try {
      const contractDocRef = db.collection("contracts").doc(contractId);
      const contractSnap = await contractDocRef.get();

      if (!contractSnap.exists) {
        throw new HttpsError("not-found", "Contract not found.");
      }

      const contractData = contractSnap.data() as Contract;

      // --- PERMISSION CHECK ---
      const isDirectOwner = contractData.userId === requesterId;
      let isAuthorizedTeamMember = false;

      if (contractData.ownerType === "agency" && contractData.ownerId) {
        const agencyDoc = await db.collection("agencies").doc(contractData.ownerId).get();
        if (agencyDoc.exists) {
          const agencyData = agencyDoc.data();
          const isAgencyOwner = agencyData?.ownerId === requesterId;
          const isTeamMember = agencyData?.team?.some((m: any) =>
            m.userId === requesterId && (m.role === "admin" || m.role === "member")
          );
          isAuthorizedTeamMember = isAgencyOwner || isTeamMember;
        }
      }

      if (!isDirectOwner && !isAuthorizedTeamMember) {
        throw new HttpsError("permission-denied", "You do not have permission to access this contract.");
      }
      // --- END PERMISSION CHECK ---

      const finalSignerEmail = signerEmailOverride || contractData.clientEmail;
      if (!finalSignerEmail) {
        throw new HttpsError("invalid-argument",
          "Signer email is missing. Please ensure client email is set or provide one.");
      }

      const creatorUserRecord = await admin.auth().getUser(contractData.userId);
      const creatorEmail = creatorUserRecord.email;
      if (!creatorEmail) {
        throw new HttpsError("failed-precondition", "Creator's email not found.");
      }

      const creatorUserDoc = await db.collection("users").doc(contractData.userId).get();
      const creatorUserData = creatorUserDoc.data() as UserProfileFirestoreData;
      if (!creatorUserData) {
        throw new HttpsError("failed-precondition", "Creator profile not found.");
      }

      const docTitle = contractData.projectName || `Contract with ${contractData.brand}`;

      // Build HTML from SFDT and write to temp file
      if (!contractData.contractText && !contractData.fileUrl) {
        throw new HttpsError("failed-precondition", "Contract has no text or file to send for signature.");
      }

      let fileStream: fs.ReadStream;
      let signaturePage = 1;

      if (contractData.contractText) {
        // Generate a proper PDF with a dedicated signature page
        const {buffer, signaturePage: sigPage} = await generateContractPdf(
          contractData.contractText,
          docTitle,
          contractData.clientName || "Client Signer",
          creatorUserData.displayName || "Creator Signer",
        );
        signaturePage = sigPage;
        tempFilePath = path.join(os.tmpdir(), `contract-${contractId}-${Date.now()}.pdf`);
        fs.writeFileSync(tempFilePath, buffer);
        fileStream = fs.createReadStream(tempFilePath);
      } else {
        // File URL path: download to temp file (must already be a PDF)
        const {default: fetch} = await import("node-fetch");
        const fileResponse = await fetch(contractData.fileUrl!);
        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
        tempFilePath = path.join(os.tmpdir(), `contract-${contractId}-${Date.now()}.pdf`);
        fs.writeFileSync(tempFilePath, fileBuffer);
        fileStream = fs.createReadStream(tempFilePath);
        signaturePage = 1; // file-based contracts: fields go on page 1
      }

      // Signature fields on the known signature page at fixed coordinates
      const clientField = new FormField();
      clientField.fieldType = FormField.FieldTypeEnum.Signature;
      clientField.pageNumber = signaturePage;
      clientField.bounds = {x: 72, y: SIGNATURE_Y - 50, width: 200, height: 50} as any;
      clientField.isRequired = true;

      const creatorField = new FormField();
      creatorField.fieldType = FormField.FieldTypeEnum.Signature;
      creatorField.pageNumber = signaturePage;
      creatorField.bounds = {x: 320, y: SIGNATURE_Y - 50, width: 200, height: 50} as any;
      creatorField.isRequired = true;

      const clientSigner = new DocumentSigner();
      clientSigner.name = contractData.clientName || "Client Signer";
      clientSigner.emailAddress = finalSignerEmail;
      clientSigner.signerOrder = 1;
      clientSigner.formFields = [clientField];

      const creatorSigner = new DocumentSigner();
      creatorSigner.name = creatorUserData.displayName || "Creator Signer";
      creatorSigner.emailAddress = creatorEmail;
      creatorSigner.signerOrder = 2;
      creatorSigner.formFields = [creatorField];

      const sendForSign = new SendForSign();
      sendForSign.title = docTitle;
      sendForSign.message =
        `Hello,\n\nPlease review and sign the attached contract for ${docTitle}.
        \n\nThank you,\n${creatorUserData.displayName || "The Sender"}`;
      sendForSign.signers = [clientSigner, creatorSigner];
      sendForSign.files = [fileStream as any];
      sendForSign.enableSigningOrder = true;

      const documentApi = new DocumentApi();
      documentApi.setApiKey(apiKey);

      const boldSignResponse = await documentApi.sendDocument(sendForSign);
      const documentId = (boldSignResponse as any).documentId;

      if (!documentId) {
        throw new HttpsError("internal", "Failed to get document ID from BoldSign.");
      }

      await contractDocRef.update({
        boldSignDocumentId: documentId,
        signatureStatus: "sent",
        lastSignatureEventAt: admin.firestore.FieldValue.serverTimestamp(),
        invoiceHistory: admin.firestore.FieldValue.arrayUnion({
          timestamp: admin.firestore.Timestamp.now(),
          action: "E-Signature Request Sent (BoldSign)",
          details: `To Client: ${finalSignerEmail}, To Creator: ${creatorEmail}. BoldSign Document ID: ${documentId}`,
        }),
      });

      logger.info(`BoldSign document ${documentId} sent for contract ${contractId}.`);
      return {
        success: true,
        message: `Signature request sent to ${finalSignerEmail} and ${creatorEmail} via BoldSign.`,
        boldSignDocumentId: documentId,
      };
    } catch (error: any) {
      logger.error(`Error initiating BoldSign request for contract ${contractId}:`, error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", error.message || "An unknown error occurred.");
    } finally {
      if (tempFilePath) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          logger.warn(`Could not delete temp file: ${tempFilePath}`, e);
        }
      }
    }
  }
);


export const boldSignWebhookHandler = onRequest(
  {secrets: [params.BOLDSIGN_WEBHOOK_SECRET]},
  async (request, response) => {
    const webhookSecret = params.BOLDSIGN_WEBHOOK_SECRET.value();

    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    // BoldSign sends the secret as a static value in a custom header (not HMAC).
    // Configure via BoldSign UI: "Add secret header", header name = "x-verza-secret".
    const receivedSecret = request.headers["x-verza-secret"] as string | undefined;
    if (webhookSecret) {
      if (!receivedSecret || receivedSecret !== webhookSecret) {
        logger.warn("BoldSign webhook: missing or invalid secret header.");
        response.status(403).send("Forbidden.");
        return;
      }
    }

    let payload: any;
    try {
      payload = typeof request.body === "object" && !Buffer.isBuffer(request.body) ?
        request.body :
        JSON.parse(request.body.toString("utf8"));
    } catch (e) {
      logger.error("Failed to parse BoldSign webhook payload.", e);
      response.status(400).send("Invalid payload.");
      return;
    }

    // Actual BoldSign payload shape:
    // payload.event.eventType  = "Completed" | "Signed" | "Viewed" | "Declined" | "Revoked" | "Expired" | "Sent"
    // payload.data.documentId
    // payload.data.signerDetails[]  — who signed/viewed
    // payload.context.actor         — actor for partial events (may be null)
    const eventType: string = payload?.event?.eventType;
    const documentId: string = payload?.data?.documentId;
    const signerDetails: any[] = payload?.data?.signerDetails || [];
    const actor = payload?.context?.actor;
    const actorName: string | null = actor?.name || actor?.emailAddress || null;

    logger.info(`BoldSign webhook received: ${eventType}`, {documentId});

    if (!eventType || !documentId) {
      response.status(200).send("OK");
      return;
    }

    try {
      const contractsRef = db.collection("contracts");
      const snap = await contractsRef
        .where("boldSignDocumentId", "==", documentId)
        .limit(1)
        .get();

      if (snap.empty) {
        logger.warn(`No contract found for boldSignDocumentId: ${documentId}`);
        response.status(200).send("OK");
        return;
      }

      const contractDocRef = snap.docs[0].ref;
      const contractData = snap.docs[0].data() as Contract;

      let newStatus: Contract["signatureStatus"] = contractData.signatureStatus;
      let historyAction: string;
      let historyDetails: string;

      switch (eventType) {
      case "Viewed": {
        newStatus = "viewed_by_signer";
        const viewer = actorName ||
          signerDetails.find((s) => s.isViewed)?.signerName ||
          "A signer";
        historyAction = "Document Viewed (BoldSign)";
        historyDetails = `${viewer} viewed the document. Document ID: ${documentId}`;
        break;
      }
      case "Signed": {
        // One signer signed; not all done yet
        const signer = actorName ||
          signerDetails.find((s) => s.status === "Completed")?.signerName ||
          "A signer";
        historyAction = `Document Signed by ${signer} (BoldSign)`;
        historyDetails = `${signer} signed the document. Awaiting remaining signers. Document ID: ${documentId}`;
        break;
      }
      case "Completed": {
        newStatus = "signed";
        const signerNames = signerDetails.map((s) => s.signerName).join(", ");
        historyAction = "Document Fully Signed — All Parties (BoldSign)";
        historyDetails = `Signed by: ${signerNames || "all parties"}. Document ID: ${documentId}`;
        break;
      }
      case "Declined": {
        newStatus = "declined";
        const decliner = actorName ||
          signerDetails.find((s) => s.status === "Declined")?.signerName ||
          "A signer";
        historyAction = `Signature Declined by ${decliner} (BoldSign)`;
        historyDetails = `${decliner} declined to sign. Document ID: ${documentId}`;
        break;
      }
      case "Revoked":
        newStatus = "canceled";
        historyAction = "Signature Request Revoked (BoldSign)";
        historyDetails = `The signature request was revoked. Document ID: ${documentId}`;
        break;
      case "Expired":
        newStatus = "canceled";
        historyAction = "Signature Request Expired (BoldSign)";
        historyDetails = `The signature request expired. Document ID: ${documentId}`;
        break;
      case "Sent":
        // Already recorded when we called sendDocument — just acknowledge
        response.status(200).send("OK");
        return;
      default:
        logger.info(`Unhandled BoldSign event type: ${eventType}`);
        response.status(200).send("OK");
        return;
      }

      const updates: any = {
        signatureStatus: newStatus,
        lastSignatureEventAt: admin.firestore.FieldValue.serverTimestamp(),
        invoiceHistory: admin.firestore.FieldValue.arrayUnion({
          timestamp: admin.firestore.Timestamp.now(),
          action: historyAction,
          details: historyDetails,
        }),
      };

      await contractDocRef.update(updates);
      logger.info(`Contract ${contractDocRef.id} updated for BoldSign event ${eventType}.`);
    } catch (error) {
      logger.error("Error processing BoldSign webhook:", error);
      response.status(500).send("Error processing webhook.");
      return;
    }

    response.status(200).send("OK");
  }
);
