import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {Timestamp} from "firebase/firestore";
import {db} from "../config/firebase"; // This initializes admin if needed via its import of admin
import type {Contract, SharedContractVersion} from "../../../src/types"; // Adjust path if necessary

interface CreateShareableContractVersionData {
  contractId: string;
  notesForBrand?: string;
}

interface CreateShareableContractVersionResult {
  sharedVersionId: string;
  shareLink: string; // e.g., /share/contract/[sharedVersionId]
}

export const createShareableContractVersion = onCall<
  CreateShareableContractVersionData,
  Promise<CreateShareableContractVersionResult>
>(async (request) => {
  // Input validation
  if (!request.auth) {
    logger.error("Unauthenticated call to createShareableContractVersion");
    throw new Error("The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const {contractId, notesForBrand} = request.data;

  // Enhanced input validation
  if (!contractId || typeof contractId !== "string") {
    logger.error("Invalid contractId in createShareableContractVersion request");
    throw new Error("Valid contract ID is required.");
  }

  if (notesForBrand && typeof notesForBrand !== "string") {
    logger.error("Invalid notesForBrand in createShareableContractVersion request");
    throw new Error("Notes for brand must be a string if provided.");
  }

  try {
    const contractDocRef = db.collection("contracts").doc(contractId);
    const contractSnap = await contractDocRef.get();

    if (!contractSnap.exists) {
      logger.error(`Contract ${contractId} not found for user ${userId}.`);
      throw new Error("Contract not found.");
    }

    const contractData = contractSnap.data() as Contract;

    if (contractData.userId !== userId) {
      logger.error(
        `User ${userId} attempted to share contract ${contractId} ` +
        "they do not own."
      );
      throw new Error("You do not have permission to share this contract.");
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
      sharedAt: Timestamp.now(),
      contractData: relevantContractData,
      notesForBrand: notesForBrand || undefined,
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
    
    // Enhanced error handling
    if (error instanceof Error) {
      if (error.message.includes("permission-denied")) {
        throw new Error("You do not have permission to perform this action.");
      }
      if (error.message.includes("not-found")) {
        throw new Error("The requested resource was not found.");
      }
      throw new Error(
        `Failed to create shareable contract version: ${error.message}`
      );
    }
    throw new Error("An unknown error occurred while creating shareable link.");
  }
});
