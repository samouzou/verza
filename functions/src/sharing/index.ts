
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Timestamp } from "firebase-admin/firestore"; // Corrected import
import {db} from "../config/firebase";
import type {Contract, SharedContractVersion} from "../../../src/types";

export const createShareableContractVersion = onCall({
  enforceAppCheck: false, // Consider enabling App Check in production
  cors: true, // Ensure your frontend origin is allowed if more restrictive CORS is needed
}, async (request) => {
  // Input validation
  if (!request.auth) {
    logger.error("Unauthenticated call to createShareableContractVersion");
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const {contractId, notesForBrand} = request.data;

  // Enhanced input validation
  if (!contractId || typeof contractId !== "string") {
    logger.error("Invalid contractId in createShareableContractVersion request");
    throw new HttpsError("invalid-argument", "Valid contract ID is required.");
  }

  if (notesForBrand && typeof notesForBrand !== "string") {
    logger.error("Invalid notesForBrand in createShareableContractVersion request");
    throw new HttpsError("invalid-argument", "Notes for brand must be a string if provided.");
  }

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
    // Exclude fields that are not relevant for the brand's view or are internal
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      id, // id of original contract, not needed in shared data itself
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      userId: contractUserId, // already have userId from auth for the sharedVersion doc
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      createdAt, // Timestamps of original contract, sharedVersion will have its own sharedAt
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      updatedAt,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      invoiceHistory, // Internal history
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      lastReminderSentAt, // Internal operational data
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      negotiationSuggestions, // Definitely don't share this
      ...relevantContractData
    } = contractData;


    const sharedVersionData: Omit<SharedContractVersion, "id"> = {
      originalContractId: contractId,
      userId: userId, // Creator's UID
      sharedAt: Timestamp.now(), // Correctly using Admin SDK Timestamp
      contractData: relevantContractData,
      notesForBrand: notesForBrand || undefined, // Store as undefined if empty string
      status: "active", // Default status
      brandHasViewed: false, // Default
    };

    // Use a transaction to ensure data consistency, though for a single write it might be overkill
    // but good practice if more operations were involved.
    const result = await db.runTransaction(async (transaction) => {
      const sharedVersionDocRef = db.collection("sharedContractVersions").doc(); // Auto-generate ID
      transaction.set(sharedVersionDocRef, sharedVersionData);
      return sharedVersionDocRef; // Return the reference
    });

    const appUrl = process.env.APP_URL || "http://localhost:9002"; // Fallback for local dev
    const shareLink = `${appUrl}/share/contract/${result.id}`;

    logger.info(
      `Created shareable version ${result.id} for ` +
      `contract ${contractId} by user ${userId}. Link: ${shareLink}`
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
      throw error; // Re-throw HttpsError directly
    }
    // For other errors, wrap in a generic internal HttpsError
    throw new HttpsError("internal", "An unknown error occurred while creating shareable link.");
  }
});
