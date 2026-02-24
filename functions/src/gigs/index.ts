
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {Gig, UserProfile, Contract} from "../types";
import {generateUgcContract} from "../ai/flows/generate-ugc-contract-flow";
import {Timestamp} from "firebase-admin/firestore";
import {v4 as uuidv4} from "uuid";


export const generateUgcAgreement = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const {gigId, creatorId} = request.data;

  if (!gigId || !creatorId) {
    throw new HttpsError("invalid-argument", "Gig ID and Creator ID are required.");
  }

  try {
    const gigDocRef = db.collection("gigs").doc(gigId);
    const gigSnap = await getDoc(gigDocRef);
    if (!gigSnap.exists) {
      throw new HttpsError("not-found", "Gig not found.");
    }
    const gigData = gigSnap.data() as Gig;

    // Permission check
    if (gigData.brandId !== request.auth.token.primaryAgencyId) {
      throw new HttpsError("permission-denied", "You do not have permission to manage this gig.");
    }

    const creatorDocRef = db.collection("users").doc(creatorId);
    const creatorSnap = await getDoc(creatorDocRef);
    if (!creatorSnap.exists) {
      throw new HttpsError("not-found", "Creator profile not found.");
    }
    const creatorData = creatorSnap.data() as UserProfile;

    // Check if a contract already exists for this gig and creator
    const contractsQuery = db.collection("contracts")
      .where("metadata.gigId", "==", gigId)
      .where("userId", "==", creatorId);
    const existingContracts = await contractsQuery.get();
    if (!existingContracts.empty) {
      throw new HttpsError("already-exists", "A contract for this gig and creator already exists.");
    }

    const {contractSfdt} = await generateUgcContract({
      brandName: gigData.brandName,
      creatorName: creatorData.displayName || "The Creator",
      gigDescription: gigData.description,
      rate: gigData.ratePerCreator,
    });

    const newContractRef = db.collection("contracts").doc();
    const accessMap: { [key: string]: "owner" | "talent" } = {
      [gigData.brandId]: "owner", // The agency owns it
      [creatorId]: "talent",
    };

    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    const newContractData: Omit<Contract, "id"> & { createdAt: any, updatedAt: any } = {
      userId: creatorId, // The creator this contract is for
      ownerType: "agency",
      ownerId: gigData.brandId,
      brand: gigData.brandName,
      projectName: gigData.title,
      amount: gigData.ratePerCreator,
      dueDate: dueDate.toISOString().split("T")[0],
      status: "pending",
      contractType: "sponsorship",
      contractText: contractSfdt,
      milestones: [{id: uuidv4(), description: "Complete UGC Deliverables",
        amount: gigData.ratePerCreator, dueDate: dueDate.toISOString().split("T")[0],
        status: "pending"}],
      fileUrl: null,
      fileName: `UGC Agreement - ${gigData.title}.docx`,
      invoiceStatus: "none",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      access: accessMap,
      metadata: {
        gigId: gigId,
      },
    } as any; // Using 'as any' to bypass strict Omit type checking for new properties

    await newContractRef.set(newContractData);

    logger.info(`Generated UGC agreement ${newContractRef.id} for gig ${gigId}`);
    return {success: true, contractId: newContractRef.id};
  } catch (error) {
    logger.error("Error generating UGC agreement:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "An unexpected error occurred while generating the agreement.");
  }
});
