
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

  if (!prompt || !style) {
    throw new HttpsError("invalid-argument", "The function requires 'prompt' and 'style' arguments.");
  }
  if (!styleOptions.includes(style)) {
    throw new HttpsError("invalid-argument", `Invalid style. Must be one of: ${styleOptions.join(", ")}`);
  }
  if (!orientation || !["16:9", "9:16"].includes(orientation)) {
    throw new HttpsError("invalid-argument", "A valid 'orientation' ('16:9' or '9:16') is required.");
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
    const ai = genkit({
      plugins: [
        googleAI({
          apiKey: process.env.VERTEX_API_KEY, // Using the dedicated Vertex key
        }),
      ],
    });
    logger.info(`Starting video generation for user ${userId} with prompt: "A ${style} style video of: ${prompt}"`);
    
    const { operation: initialOperation } = await ai.generate({
      model: googleAI.model("veo-2.0-generate-001"), // Switched to stable model
      prompt: `A ${style} style video of: ${prompt}`,
      config: {
        durationSeconds: 8,
        aspectRatio: orientation,
      },
    });

    if (!initialOperation) {
      throw new Error("Video generation did not return an operation to track.");
    }
    
    let operation = initialOperation;
    let pollAttempts = 0;
    const maxPollAttempts = 10;
    
    while (!operation.done) {
      pollAttempts++;
      if (pollAttempts > maxPollAttempts) {
          throw new Error("Video generation timed out after multiple polling attempts.");
      }
      
      logger.info(`Polling video generation operation for user ${userId} (Attempt ${pollAttempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

      try {
        operation = await ai.checkOperation(operation);
      } catch (pollError: any) {
        logger.warn(`Polling attempt ${pollAttempts} failed with status ${pollError.status}. Retrying...`, { error: pollError.message });
        if (pollAttempts >= maxPollAttempts) {
          throw pollError; // Re-throw if max attempts reached
        }
        // Simple wait before next poll, could add exponential backoff here too if needed
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (operation.error) {
      throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    const video = operation.output?.message?.content.find((p: any) => !!p.media);
    if (!video || !video.media) {
      throw new Error("Failed to find the generated video in the model response.");
    }
    
    logger.info(`Video generated. Downloading from URL for user ${userId}.`);
    const fetch = (await import("node-fetch")).default;
    const videoDownloadResponse = await fetch(
      `${video.media.url}&key=${process.env.VERTEX_API_KEY}` // Using the dedicated Vertex key
    );

    if (!videoDownloadResponse.ok || !videoDownloadResponse.body) {
      throw new Error(`Failed to download generated video. Status: ${videoDownloadResponse.status}`);
    }

    const videoBuffer = await videoDownloadResponse.buffer();

    // 4. Upload to Firebase Storage
    const videoFileName = `${Date.now()}-${uuidv4()}.mp4`;
    const videoFile = defaultBucket.file(`generated-scenes/${userId}/${videoFileName}`);
    
    logger.info(`Uploading video to Storage for user ${userId} as ${videoFileName}.`);
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
      orientation: orientation,
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
