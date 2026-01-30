
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {Timestamp as AdminTimestamp} from "firebase-admin/firestore"; // Use an alias for Admin SDK Timestamp
import {db} from "../config/firebase";
import type {Contract, SharedContractVersion, UserProfileFirestoreData} from "./types";
import type {Timestamp as ClientTimestamp} from "firebase/firestore"; // For casting target

export const createShareableContractVersion = onCall({
  enforceAppCheck: false,
  cors: true,
}, async (request) => {
  // Input validation
  if (!request.auth) {
    logger.error("Unauthenticated call to createShareableContractVersion");
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const requesterId = request.auth.uid;
  // Explicitly get rawNotesForBrand, which could be undefined if not sent
  const {contractId, notesForBrand: rawNotesForBrand} = request.data;

  // Enhanced input validation
  if (!contractId || typeof contractId !== "string") {
    logger.error("Invalid contractId in createShareableContractVersion request");
    throw new HttpsError("invalid-argument", "Valid contract ID is required.");
  }

  // Process notesForBrand robustly:
  let processedNotesForBrand: string | null = null;
  if (typeof rawNotesForBrand === "string") {
    const trimmedNotes = rawNotesForBrand.trim();
    if (trimmedNotes.length > 0) {
      processedNotesForBrand = trimmedNotes;
    }
  }
  // If rawNotesForBrand was undefined, or an empty/whitespace string, processedNotesForBrand remains null.

  try {
    const contractDocRef = db.collection("contracts").doc(contractId);
    const contractSnap = await contractDocRef.get();

    if (!contractSnap.exists) {
      logger.error(`Contract ${contractId} not found for user ${requesterId}.`);
      throw new HttpsError("not-found", "Contract not found.");
    }

    const contractData = contractSnap.data() as Contract;

    // PERMISSION CHECK: User must be direct owner OR agency owner
    const requesterDoc = await db.collection("users").doc(requesterId).get();
    const requesterData = requesterDoc.data() as UserProfileFirestoreData;
    const agencyId = requesterData.agencyMemberships?.find((m) => m.role === "owner")?.agencyId;

    const isDirectOwner = contractData.userId === requesterId;
    const isAgencyOwner = requesterData.role === "agency_owner" &&
      contractData.ownerType === "agency" && contractData.ownerId === agencyId;

    if (!isDirectOwner && !isAgencyOwner) {
      logger.error(
        `User ${requesterId} attempted to share contract ${contractId} ` +
        "they do not own.", {contractOwner: contractData.userId, contractAgency: contractData.ownerId, requesterAgency: agencyId}
      );
      throw new HttpsError("permission-denied", "You do not have permission to share this contract.");
    }


    // Prepare the snapshot of contract data to be shared
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      id,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      userId: contractUserId,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      createdAt,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      updatedAt,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      invoiceHistory,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      lastReminderSentAt,
      ...relevantContractData
    } = contractData;


    const sharedVersionData: Omit<SharedContractVersion, "id"> = {
      originalContractId: contractId,
      userId: contractData.userId, // Always attribute the share to the original creator
      sharedAt: AdminTimestamp.now() as unknown as ClientTimestamp,
      contractData: relevantContractData,
      notesForBrand: processedNotesForBrand, // Use the explicitly processed value
      status: "active",
      brandHasViewed: false,
    };

    const result = await db.runTransaction(async (transaction) => {
      const sharedVersionDocRef = db.collection("sharedContractVersions").doc();
      transaction.set(sharedVersionDocRef, sharedVersionData);
      return sharedVersionDocRef;
    });

    const appUrl = process.env.APP_URL || "http://localhost:9002";
    const shareLink = `${appUrl}/share/contract/${result.id}`;

    logger.info(
      `Created shareable version ${result.id} for ` +
      `contract ${contractId} by user ${requesterId}.`
    );

    return {
      sharedVersionId: result.id,
      shareLink: shareLink,
    };
  } catch (error) {
    logger.error(
      "Error in createShareableContractVersion for user " +
      `${requesterId}, contract ${contractId}:`, error
    );

    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An unknown error occurred while creating shareable link.");
  }
});


export const getPublicContractDetails = onCall({
  enforceAppCheck: false, // Allow public access
  cors: true,
}, async (request) => {
  const {contractId} = request.data;
  if (!contractId || typeof contractId !== "string") {
    throw new HttpsError("invalid-argument", "Valid contract ID is required.");
  }

  try {
    const contractDocRef = db.collection("contracts").doc(contractId);
    const contractSnap = await contractDocRef.get();

    if (!contractSnap.exists) {
      throw new HttpsError("not-found", "The requested contract could not be found.");
    }

    const contractData = contractSnap.data() as Contract;

    // Return only the data that is safe to be public for the payment page
    const publicData = {
      id: contractSnap.id,
      brand: contractData.brand,
      projectName: contractData.projectName,
      invoiceStatus: contractData.invoiceStatus,
      clientEmail: contractData.clientEmail || null,
      milestones: contractData.milestones || null,
      amount: contractData.amount, // Include total amount as a fallback
      editableInvoiceDetails: contractData.editableInvoiceDetails || null, // **** ADD THIS LINE ****
    };

    return publicData;
  } catch (error) {
    logger.error(`Error fetching public details for contract ${contractId}:`, error);
    throw new HttpsError("internal", "An error occurred while fetching contract details.");
  }
});
