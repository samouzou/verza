
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {GoogleGenAI} from "@google/genai";
import {v4 as uuidv4} from "uuid";
import type {Generation} from "../types";

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;

export const generateScene = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {prompt, style} = request.data;
  const userId = request.auth.uid;

  if (!prompt || !style) {
    throw new HttpsError("invalid-argument", "The function requires 'prompt' and 'style' arguments.");
  }
  if (!styleOptions.includes(style)) {
    throw new HttpsError("invalid-argument", `Invalid style. Must be one of: ${styleOptions.join(", ")}`);
  }

  // Use the initialized admin app
  const adminDb = admin.firestore();
  const adminStorage = admin.storage();
  const defaultBucket = adminStorage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);

  let userCredits = 0;
  const userDocRef = adminDb.collection("users").doc(userId);

  // 1. Check and decrement credits in a transaction
  try {
    await adminDb.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "User document not found.");
      }
      userCredits = userDoc.data()?.credits || 0;
      if (userCredits <= 0) {
        throw new HttpsError("failed-precondition", "Insufficient credits. You need at least 1 credit to generate a scene.");
      }
      transaction.update(userDocRef, {credits: userCredits - 1});
    });
  } catch (error) {
    logger.error("Credit transaction failed for user", userId, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to process user credits.");
  }

  const remainingCredits = userCredits - 1;

  try {
    // 2. Generate video with Veo via Google AI SDK
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY as string);
    const model = genAI.getGenerativeModel({model: "veo"});

    const generationConfig = {
      requestOptions: {
        timeout: 600000, // 10 minutes
      },
    };

    logger.info(`Starting video generation for user ${userId} with prompt: "A ${style} style video of: ${prompt}"`);

    const result = await model.generateContent([
      `A ${style} style video of: ${prompt}`,
      {
        inlineData: {
          mimeType: "video/mp4",
          data: "placeholder", // VEO API might not require data for text-to-video
        },
      },
    ]);

    // The Google AI SDK for Node.js currently returns the final result directly for Veo, not an operation.
    // Polling logic is handled by the SDK client.
    const videoPart = result.response.candidates?.[0].content.parts.find((p) => "fileData" in p);

    if (!videoPart || !("fileData" in videoPart)) {
      throw new Error("Failed to find the generated video in the model response.");
    }

    const videoBuffer = Buffer.from(videoPart.fileData.fileUri, "base64");

    // 4. Upload to Firebase Storage
    const videoFileName = `${Date.now()}-${uuidv4()}.mp4`;
    const videoFile = defaultBucket.file(`generated-scenes/${userId}/${videoFileName}`);

    await videoFile.save(videoBuffer, {
      metadata: {
        contentType: "video/mp4",
      },
    });

    await videoFile.makePublic();
    const finalVideoUrl = videoFile.publicUrl();

    // 5. Save generation record to Firestore
    const generationData: Omit<Generation, "id"> = {
      userId,
      prompt,
      style,
      videoUrl: finalVideoUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp() as any,
    };
    const generationDocRef = await adminDb.collection("generations").add(generationData);

    logger.info(`Successfully generated and stored video for user ${userId}`, {videoUrl: finalVideoUrl});

    return {
      videoUrl: finalVideoUrl,
      generationId: generationDocRef.id,
      remainingCredits,
    };
  } catch (error) {
    logger.error("Video generation or storage failed for user", userId, error);
    // Refund credit on failure
    await userDocRef.update({credits: admin.firestore.FieldValue.increment(1)});
    throw new HttpsError("internal", "Failed to generate or save the video. Your credit has been refunded.");
  }
});
