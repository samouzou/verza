
'use server';
/**
 * @fileOverview Generates a short video clip using AI based on a user prompt.
 * - generateScene - A function that handles video generation, credit checking, and file storage.
 */

import {ai} from '../genkit';
import { googleAI } from '@genkit-ai/google-genai';
import {z} from 'genkit';
import * as admin from 'firebase-admin';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import type {MediaPart} from 'genkit';
import {v4 as uuidv4} from 'uuid';

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;

type GenerateSceneInput = z.infer<typeof GenerateSceneInputSchema>;
const GenerateSceneInputSchema = z.object({
  userId: z.string().describe("The UID of the user requesting the generation."),
  prompt: z.string().describe('The text prompt describing the scene to generate.'),
  style: z.enum(styleOptions).describe('The artistic style for the generated video.'),
});

type GenerateSceneOutput = z.infer<typeof GenerateSceneOutputSchema>;
const GenerateSceneOutputSchema = z.object({
  videoUrl: z.string().url().describe('The public URL of the generated video in Firebase Storage.'),
  generationId: z.string().describe('The ID of the generation record in Firestore.'),
  remainingCredits: z.number().describe('The number of credits the user has left.'),
});

export async function generateScene(input: GenerateSceneInput): Promise<GenerateSceneOutput> {
  return generateSceneFlow(input);
}

const generateSceneFlow = ai.defineFlow(
  {
    name: 'generateSceneFlow',
    inputSchema: GenerateSceneInputSchema,
    outputSchema: GenerateSceneOutputSchema,
  },
  async ({ userId, prompt, style }) => {
    // Initialize Firebase Admin SDK if not already done
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const adminDb = admin.firestore();
    const adminStorage = getAdminStorage();
    const defaultBucket = adminStorage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    
    let userCredits = 0;
    const userDocRef = adminDb.collection('users').doc(userId);

    // 1. Check and decrement credits in a transaction
    await adminDb.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists) {
        throw new Error("User not found.");
      }
      userCredits = userDoc.data()?.credits || 0;
      if (userCredits <= 0) {
        throw new Error("Insufficient credits. You need at least 1 credit to generate a scene.");
      }
      transaction.update(userDocRef, { credits: userCredits - 1 });
    });
    
    const remainingCredits = userCredits - 1;

    // 2. Generate video with Veo
    let { operation } = await ai.generate({
      model: googleAI.model('veo-2.0-generate-001'),
      prompt: `A ${style} style video of: ${prompt}`,
      config: {
        durationSeconds: 5,
        aspectRatio: '16:9',
      },
    });

    if (!operation) {
      throw new Error('Expected the model to return an operation');
    }

    // 3. Poll for completion
    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
      operation = await ai.checkOperation(operation);
    }

    if (operation.error) {
      // Refund credit on failure
      await adminDb.runTransaction(async (transaction) => {
        transaction.update(userDocRef, { credits: userCredits });
      });
      throw new Error('Failed to generate video: ' + operation.error.message);
    }

    const video = operation.output?.message?.content.find((p) => !!p.media);
    if (!video || !video.media?.url) {
      // Refund credit on failure
       await adminDb.runTransaction(async (transaction) => {
        transaction.update(userDocRef, { credits: userCredits });
      });
      throw new Error('Failed to find the generated video in the model response.');
    }

    // 4. Download video from Google's temporary URL
    const fetch = (await import('node-fetch')).default;
    const videoDownloadResponse = await fetch(
      `${video.media.url}&key=${process.env.GEMINI_API_KEY}`
    );
    if (!videoDownloadResponse.ok || !videoDownloadResponse.body) {
      // Refund credit on failure
       await adminDb.runTransaction(async (transaction) => {
        transaction.update(userDocRef, { credits: userCredits });
      });
      throw new Error(`Failed to fetch generated video. Status: ${videoDownloadResponse.status}`);
    }
    const videoBuffer = await videoDownloadResponse.buffer();

    // 5. Upload to Firebase Storage
    const videoFileName = `${Date.now()}-${uuidv4()}.mp4`;
    const videoFile = defaultBucket.file(`generated-scenes/${userId}/${videoFileName}`);
    
    await videoFile.save(videoBuffer, {
      metadata: {
        contentType: 'video/mp4',
      },
    });
    
    await videoFile.makePublic();
    const finalVideoUrl = videoFile.publicUrl();

    // 6. Save generation record to Firestore
    const generationData = {
      userId,
      prompt,
      style,
      videoUrl: finalVideoUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    const generationDocRef = await adminDb.collection('generations').add(generationData);

    return {
      videoUrl: finalVideoUrl,
      generationId: generationDocRef.id,
      remainingCredits,
    };
  }
);
