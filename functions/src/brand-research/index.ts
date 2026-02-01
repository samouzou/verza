import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import axios from "axios";
import * as cheerio from "cheerio";
import {analyzeBrandWebsite, type BrandAnalysisOutput} from "../ai/flows/brand-analysis-flow";
import type {BrandResearch} from "./../types";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const analyzeBrand = onCall({
  timeoutSeconds: 300,
  memory: "1GiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {brandUrl} = request.data;
  const uid = request.auth.uid;

  if (!brandUrl || typeof brandUrl !== "string") {
    throw new HttpsError("invalid-argument", "A valid 'brandUrl' is required.");
  }

  const researchDocRef = db.collection("brand_research").doc();
  const initialData: BrandResearch = {
    id: researchDocRef.id,
    uid,
    brandUrl,
    brandName: "Analyzing...",
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp() as any,
  };
  await researchDocRef.set(initialData);

  try {
    // 1. Fetch HTML content
    const {data: html} = await axios.get(brandUrl, {timeout: 10000});
    const $ = cheerio.load(html);
    // Remove script, style, and nav tags for cleaner text
    $("script, style, nav, footer, header").remove();
    const websiteText = $("body").text().replace(/\s\s+/g, " ").trim();

    if (!websiteText) {
      throw new Error("Could not extract text content from the website.");
    }

    // 2. Pass to AI flow
    const analysisResult: BrandAnalysisOutput = await analyzeBrandWebsite({brandUrl, websiteText});

    // 3. Save result to Firestore
    const finalData: Partial<BrandResearch> = {
      brandName: analysisResult.brandName,
      status: "completed",
      report: {
        decisionMakers: analysisResult.decisionMakers,
        currentVibe: analysisResult.currentVibe,
        pitchHooks: analysisResult.pitchHooks,
      },
    };
    await researchDocRef.update(finalData);

    return {success: true, researchId: researchDocRef.id, report: finalData};
  } catch (error: any) {
    logger.error(`Error analyzing brand URL ${brandUrl} for user ${uid}:`, error);

    const errorData: Partial<BrandResearch> = {
      status: "failed",
      brandName: "Analysis Failed",
      error: error.message || "An unknown error occurred.",
    };
    await researchDocRef.update(errorData);

    if (axios.isAxiosError(error)) {
      throw new HttpsError("internal", `Could not fetch the URL. Status: ${error.response?.status}`);
    }
    throw new HttpsError("internal", error.message || "Failed to analyze the brand.");
  }
});
