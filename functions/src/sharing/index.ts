
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Timestamp as AdminTimestamp } from "firebase-admin/firestore"; // Use an alias for Admin SDK Timestamp
import {db} from "../config/firebase"; // This initializes admin if needed via its import of admin
import type {Contract, SharedContractVersion} from "@/types"; // Use path alias
import type {Timestamp as ClientTimestamp} from "firebase/firestore"; // For casting target

export const createShareableContractVersion = onCall({
  enforceAppCheck: false, // As per user's existing setup
  cors: true, // As per user's existing setup
}, async (request) => {
  // Input validation
  if (!request.auth) {
    logger.error("Unauthenticated call to createShareableContractVersion");
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const {contractId, notesForBrand: rawNotesForBrand} = request.data;
  const notesForBrand = typeof rawNotesForBrand === 'string' ? rawNotesForBrand.trim() : "";


  // Enhanced input validation
  if (!contractId || typeof contractId !== "string") {
    logger.error("Invalid contractId in createShareableContractVersion request");
    throw new HttpsError("invalid-argument", "Valid contract ID is required.");
  }

  // notesForBrand is optional, so no validation needed if it's empty or not a string after trim

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
      id,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      userId: contractUserId, // already have userId from auth
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      createdAt,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      updatedAt,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      invoiceHistory,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      lastReminderSentAt,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      negotiationSuggestions, // Definitely don't share this
      ...relevantContractData
    } = contractData;


    const sharedVersionData: Omit<SharedContractVersion, "id"> = {
      originalContractId: contractId,
      userId: userId,
      sharedAt: AdminTimestamp.now() as unknown as ClientTimestamp, // Cast to client Timestamp
      contractData: relevantContractData,
      notesForBrand: notesForBrand || null, // Store null if notesForBrand is empty or not provided
      status: "active",
      brandHasViewed: false,
    };

    // Use a transaction to ensure data consistency
    const result = await db.runTransaction(async (transaction) => {
      const sharedVersionDocRef = db.collection("sharedContractVersions").doc();
      transaction.set(sharedVersionDocRef, sharedVersionData);
      return sharedVersionDocRef;
    });

    const appUrl = process.env.APP_URL || "http://localhost:9002"; // Fallback for local dev
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
