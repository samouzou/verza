
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Timestamp as AdminTimestamp } from "firebase-admin/firestore"; // Use an alias for Admin SDK Timestamp
import {db} from "../config/firebase";
import type {Contract, SharedContractVersion} from "../../../src/types"; // Reverted to relative path
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

  const userId = request.auth.uid;
  // Explicitly get rawNotesForBrand, which could be undefined if not sent
  const {contractId, notesForBrand: rawNotesForBrand} = request.data;

  // Enhanced input validation
  if (!contractId || typeof contractId !== "string") {
    logger.error("Invalid contractId in createShareableContractVersion request");
    throw new HttpsError("invalid-argument", "Valid contract ID is required.");
  }

  // Process notesForBrand robustly:
  let processedNotesForBrand: string | null = null;
  if (typeof rawNotesForBrand === 'string') {
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
      logger.error(`Contract ${contractId} not found for user ${userId}.`);
      throw new HttpsError("not-found", "Contract not found.");
    }

    const contractData = contractSnap.data() as Contract;

    if (contractData.userId !== userId) {
      logger.error(
        `User ${userId} attempted to share contract ${contractId} ` +
        "they do not own."
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      negotiationSuggestions,
      ...relevantContractData
    } = contractData;


    const sharedVersionData: Omit<SharedContractVersion, "id"> = {
      originalContractId: contractId,
      userId: userId,
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
      `contract ${contractId} by user ${userId}.`
    );

    return {
      sharedVersionId: result.id,
      shareLink: shareLink,
    };
  } catch (error) {
    logger.error(
      "Error in createShareableContractVersion for user " +
      `${userId}, contract ${contractId}:`, error
    );
    
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An unknown error occurred while creating shareable link.");
  }
});
