
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {googleAI} from "@genkit-ai/google-genai";
import {v4 as uuidv4} from "uuid";
import type {Generation} from "./../types";
import * as params from "../config/params";
import {ai} from "../ai/genkit"; // Import the shared AI instance

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;
const IMAGE_COST = 1;
const RATE_LIMIT_SECONDS = 15; // Shorter rate limit for images

export const generateImage = onCall({
  timeoutSeconds: 120,
  memory: "1GiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {prompt, style, orientation, imageDataUri} = request.data;
  const userId = request.auth.uid;

  if (!prompt || !style) {
    throw new HttpsError("invalid-argument", "The function requires 'prompt' and 'style' arguments.");
  }
  if (!styleOptions.includes(style)) {
    throw new HttpsError("invalid-argument", `Invalid style. Must be one of: ${styleOptions.join(", ")}`);
  }
  if (!orientation || !["16:9", "9:16", "1:1"].includes(orientation)) {
    throw new HttpsError("invalid-argument", "A valid 'orientation' ('16:9', '9:16', or '1:1') is required.");
  }
  if (!imageDataUri || typeof imageDataUri !== "string") {
    throw new HttpsError("invalid-argument", "An 'imageDataUri' must be a string for image-to-image generation.");
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const adminDb = admin.firestore();
  const adminStorage = admin.storage();
  const defaultBucket = adminStorage.bucket(params.APP_STORAGE_BUCKET.value());

  const userDocRef = adminDb.collection("users").doc(userId);

  // Rate Limiting
  const rateLimitCutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
  const recentGenerationsQuery = adminDb.collection("generations")
    .where("userId", "==", userId)
    .where("timestamp", ">", rateLimitCutoff)
    .limit(1);

  const recentGenerationsSnapshot = await recentGenerationsQuery.get();
  if (!recentGenerationsSnapshot.empty) {
    throw new HttpsError("resource-exhausted", `Please wait at least ${RATE_LIMIT_SECONDS} seconds between generations.`);
  }

  // Credits check
  try {
    await adminDb.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists) throw new HttpsError("not-found", "User document not found.");
      const userCredits = userDoc.data()?.credits || 0;
      if (userCredits < IMAGE_COST) {
        throw new HttpsError("failed-precondition", `Insufficient credits. Image generation costs ${IMAGE_COST} credit.`);
      }
      transaction.update(userDocRef, {credits: admin.firestore.FieldValue.increment(-IMAGE_COST)});
    });
  } catch (error: any) {
    logger.error("Credit transaction failed for user", userId, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to process user credits.");
  }

  let sourceImageUrl: string | null = null;

  // Generate image
  try {
    // Store source image
    const sourceImageFileName = `${Date.now()}-source-${uuidv4()}.jpeg`;
    const sourceImageFile = defaultBucket.file(`generated-scenes/${userId}/${sourceImageFileName}`);
    const imageBufferFromUri = Buffer.from(imageDataUri.split(",")[1], "base64");
    await sourceImageFile.save(imageBufferFromUri, {metadata: {contentType: "image/jpeg"}});
    const [signedSourceUrl] = await sourceImageFile.getSignedUrl({action: "read", expires: Date.now() + 1000 * 60 * 60 * 24 * 7});
    sourceImageUrl = signedSourceUrl;

    logger.info(`Starting image-to-image generation for user ${userId}.`);
    const {media} = await ai.generate({
      model: googleAI.model("gemini-2.5-flash-image"),
      prompt: [
        {text: `In a ${style} style: ${prompt}`},
        {media: {url: imageDataUri, contentType: "image/jpeg"}},
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    if (!media || !media.url) {
      throw new Error("Image generation failed to return media.");
    }

    logger.info(`Image generated for user ${userId}.`);

    const generatedImageBuffer = Buffer.from(media.url.substring(media.url.indexOf(",") + 1), "base64");

    const imageFileName = `${Date.now()}-${uuidv4()}.png`;
    const imageFile = defaultBucket.file(`generated-scenes/${userId}/${imageFileName}`);

    await imageFile.save(generatedImageBuffer, {metadata: {contentType: "image/png"}});

    const [signedUrl] = await imageFile.getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });

    const finalImageUrl = signedUrl;

    const generationData: Omit<Generation, "id"> = {
      userId,
      prompt,
      style,
      imageUrl: finalImageUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp() as any,
      orientation: orientation,
      cost: IMAGE_COST,
      sourceImageUrl: sourceImageUrl,
    };
    const generationDocRef = await adminDb.collection("generations").add(generationData);

    const updatedUserDoc = await userDocRef.get();
    const remainingCredits = updatedUserDoc.data()?.credits ?? 0;

    return {
      imageUrl: finalImageUrl,
      generationId: generationDocRef.id,
      remainingCredits,
    };
  } catch (error: any) {
    logger.error("Image generation or storage failed for user", userId, {errorMessage: error.message});
    try {
      await userDocRef.update({credits: admin.firestore.FieldValue.increment(IMAGE_COST)});
      logger.info(`Refunded ${IMAGE_COST} credit to user ${userId} after failure.`);
    } catch (refundError) {
      logger.error(`CRITICAL: Failed to refund credit to user ${userId}.`, refundError);
    }
    throw new HttpsError("internal", error.message || "Failed to generate or save the image.");
  }
});
