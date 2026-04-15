
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import type {Contract} from "./../types";

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
