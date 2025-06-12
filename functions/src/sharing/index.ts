
import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {db} from "../config/firebase";
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
  if (!request.auth) {
    logger.error("Unauthenticated call to createShareableContractVersion");
    throw new Error("The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const {contractId, notesForBrand} = request.data;

  if (!contractId) {
    logger.error("Missing contractId in createShareableContractVersion request");
    throw new Error("Contract ID is required.");
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
      userId: userId, // Creator's UID
      sharedAt: admin.firestore.Timestamp.now(),
      contractData: relevantContractData,
      notesForBrand: notesForBrand || undefined,
      status: "active",
      brandHasViewed: false,
    };

    const sharedVersionDocRef = await db
      .collection("sharedContractVersions")
      .add(sharedVersionData);

    const appUrl = process.env.APP_URL || "http://localhost:9002"; // Fallback for local dev
    const shareLink = `${appUrl}/share/contract/${sharedVersionDocRef.id}`;

    logger.info(
      `Created shareable version ${sharedVersionDocRef.id} for ` +
      `contract ${contractId} by user ${userId}.`
    );

    return {
      sharedVersionId: sharedVersionDocRef.id,
      shareLink: shareLink,
    };
  } catch (error) {
    logger.error(
      "Error in createShareableContractVersion for user " +
      `${userId}, contract ${contractId}:`, error
    );
    if (error instanceof Error) {
      throw new Error(
        `Failed to create shareable contract version: ${error.message}`
      );
    }
    throw new Error("An unknown error occurred while creating shareable link.");
  }
});
