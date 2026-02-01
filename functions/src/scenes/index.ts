
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {genkit} from "genkit";
import {googleAI} from "@genkit-ai/google-genai";
import {v4 as uuidv4} from "uuid";
import type {Generation} from "./../types";

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;
const VIDEO_COST = 10;
const RATE_LIMIT_SECONDS = 60;


export const generateScene = onCall({
  timeoutSeconds: 300, // Increased timeout for long-running video generation
  memory: "1GiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {prompt, style, orientation} = request.data;
  const userId = request.auth.uid;

  if (!prompt || !style || !orientation) {
    throw new HttpsError("invalid-argument", "The function requires 'prompt', 'style', and 'orientation' arguments.");
  }
  if (!styleOptions.includes(style)) {
    throw new HttpsError("invalid-argument", `Invalid style. Must be one of: ${styleOptions.join(", ")}`);
  }
  if (!["16:9", "9:16"].includes(orientation)) {
    throw new HttpsError("invalid-argument", "Invalid orientation. Must be '16:9' or '9:16'.");
  }

  // Initialize Admin SDK inside the function
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const adminDb = admin.firestore();
  const adminStorage = admin.storage();
  const defaultBucket = adminStorage.bucket(process.env.FIREBASE_STORAGE_BUCKET);

  const userDocRef = adminDb.collection("users").doc(userId);

  // 1. Rate Limiting Check (before transaction)
  const rateLimitCutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
  const recentGenerationsQuery = adminDb.collection("generations")
    .where("userId", "==", userId)
    .where("timestamp", ">", rateLimitCutoff)
    .limit(1);

  const recentGenerationsSnapshot = await recentGenerationsQuery.get();
  if (!recentGenerationsSnapshot.empty) {
    throw new HttpsError("resource-exhausted", `Please wait at least ${RATE_LIMIT_SECONDS} seconds between video generations.`);
  }

  // 2. Check and decrement credits in a transaction
  try {
    await adminDb.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "User document not found.");
      }
      const userCredits = userDoc.data()?.credits || 0;
      if (userCredits < VIDEO_COST) {
        throw new HttpsError("failed-precondition", `Insufficient credits. A scene costs ${VIDEO_COST} credits.`);
      }
      // Deduct credits
      transaction.update(userDocRef, {credits: admin.firestore.FieldValue.increment(-VIDEO_COST)});
    });
  } catch (error: any) {
    logger.error("Credit transaction failed for user", userId, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to process user credits.");
  }

  // 3. Generate video
  try {
    // Initialize Genkit within the function
    const ai = genkit({plugins: [googleAI({apiKey: process.env.GEMINI_API_KEY})]});

    logger.info(`Starting video generation for user ${userId} with prompt: "A ${style} style video of: ${prompt}"`);

    let {operation} = await ai.generate({
      model: googleAI.model("veo-2.0-generate-001"),
      prompt: `A ${style} style video of: ${prompt}`,
      config: {
        durationSeconds: 5,
        aspectRatio: orientation,
      },
    });

    if (!operation) {
      throw new Error("Expected the model to return an operation for video generation.");
    }

    // Poll for completion
    while (!operation.done) {
      logger.info(`Polling video generation operation for user ${userId}...`);
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      operation = await ai.checkOperation(operation);
    }

    if (operation.error) {
      throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    const video = operation.output?.message?.content.find((p: any) => !!p.media);

    if (!video || !video.media) {
      throw new Error("Failed to find the generated video in the model response.");
    }

    const fetch = (await import("node-fetch")).default;
    const videoDownloadResponse = await fetch(
      `${video.media.url}&key=${process.env.GEMINI_API_KEY}`
    );

    if (!videoDownloadResponse.ok || !videoDownloadResponse.body) {
      throw new Error(`Failed to download generated video. Status: ${videoDownloadResponse.status}`);
    }

    const videoBuffer = await videoDownloadResponse.buffer();

    // 4. Upload to Firebase Storage
    const videoFileName = `${Date.now()}-${uuidv4()}.mp4`;
    const videoFile = defaultBucket.file(`generated-scenes/${userId}/${videoFileName}`);

    await videoFile.save(videoBuffer, {
      metadata: {
        contentType: "video/mp4",
      },
    });

    // Generate a signed URL that expires in 7 days.
    const [signedUrl] = await videoFile.getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    const finalVideoUrl = signedUrl;

    // 5. Save generation record to Firestore
    const generationData: Omit<Generation, "id"> = {
      userId,
      prompt,
      style,
      videoUrl: finalVideoUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp() as any,
      orientation,
      cost: VIDEO_COST, // Add cost to generation record
    };
    const generationDocRef = await adminDb.collection("generations").add(generationData);

    const updatedUserDoc = await userDocRef.get();
    const remainingCredits = updatedUserDoc.data()?.credits ?? 0;

    logger.info(`Successfully generated and stored video for user ${userId}`, {videoUrl: finalVideoUrl});

    return {
      videoUrl: finalVideoUrl,
      generationId: generationDocRef.id,
      remainingCredits,
    };
  } catch (error: any) {
    logger.error("Video generation or storage failed for user", userId, error);
    // Refund credit on failure
    await userDocRef.update({credits: admin.firestore.FieldValue.increment(VIDEO_COST)});
    throw new HttpsError("internal", error.message || "Failed to generate or save the video. Your credit has been refunded.");
  }
});
