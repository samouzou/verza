import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {FieldValue, type DocumentReference, type Firestore} from "firebase-admin/firestore";
import {v4 as uuidv4} from "uuid";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {Generation} from "./../types";
import * as params from "../config/params";
import {resolveReferenceImageDataUri} from "../ai/referenceImage";

const MODEL = "gemini-omni-flash-preview";
const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;
const VIDEO_COST = 10;
const EDIT_COST = 10;
const RATE_LIMIT_SECONDS = 60;
const MAX_FILE_POLL_ATTEMPTS = 36;
const MAX_EDIT_PROMPT = 2000;

type OmniTask = "text_to_video" | "image_to_video" | "reference_to_video" | "edit";

type OmniClient = {
  interactions: {
    create: (args: Record<string, unknown>) => Promise<{
      id?: string;
      output_video?: {data?: string; uri?: string};
      steps?: Array<{content?: unknown[]}>;
    }>;
  };
  files: {
    get: (args: {name: string}) => Promise<{state?: string | {name?: string}}>;
    download: (args: {file: string; downloadPath: string}) => Promise<void>;
  };
};

type OmniImagePart = {
  type: "image";
  data: string;
  mime_type: string;
};

type OmniTextPart = {type: "text"; text: string};

/**
 * Loads @google/genai via dynamic import (ESM package in a CJS functions build).
 * @param {string} apiKey Gemini API key.
 * @return {Promise<OmniClient>} Client instance.
 */
async function createOmniClient(apiKey: string): Promise<OmniClient> {
  const {GoogleGenAI} = await import("@google/genai");
  return new GoogleGenAI({apiKey}) as unknown as OmniClient;
}

/**
 * Parses mime + base64 from a data URI.
 * @param {string} dataUri Image data URI.
 * @return {{mime: string, data: string}} Parsed parts.
 */
function parseDataUri(dataUri: string): {mime: string; data: string} {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URI.");
  }
  return {mime: match[1] || "image/jpeg", data: match[2]};
}

/**
 * Builds an Omni image input part from a data URI.
 * @param {string} dataUri Image data URI.
 * @return {OmniImagePart} Omni image part.
 */
function imagePartFromDataUri(dataUri: string): OmniImagePart {
  const {mime, data} = parseDataUri(dataUri);
  return {type: "image", data, mime_type: mime};
}

/**
 * Polls a Files API URI until ACTIVE, then downloads bytes.
 * @param {OmniClient} client Gemini client.
 * @param {string} fileUri files/... URI.
 * @return {Promise<Buffer>} Video bytes.
 */
async function downloadVideoFromUri(
  client: OmniClient,
  fileUri: string
): Promise<Buffer> {
  const match = fileUri.match(/files\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(`Unexpected video file URI: ${fileUri}`);
  }
  const name = `files/${match[1]}`;
  const tmpPath = path.join(os.tmpdir(), `omni-${uuidv4()}.mp4`);

  let attempts = 0;
  while (attempts < MAX_FILE_POLL_ATTEMPTS) {
    attempts++;
    const fInfo = await client.files.get({name});
    const state =
      typeof fInfo.state === "string" ?
        fInfo.state :
        (fInfo.state as {name?: string} | undefined)?.name;

    if (state === "ACTIVE") break;
    if (state === "FAILED") {
      throw new Error("Video file processing failed.");
    }
    logger.info(`Waiting for Omni video file (${attempts}/${MAX_FILE_POLL_ATTEMPTS})`, {
      name,
      state,
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  const finalInfo = await client.files.get({name});
  const finalState =
    typeof finalInfo.state === "string" ?
      finalInfo.state :
      (finalInfo.state as {name?: string} | undefined)?.name;
  if (finalState !== "ACTIVE") {
    throw new Error(`Video file not ready after polling (state=${finalState}).`);
  }

  await client.files.download({file: name, downloadPath: tmpPath});
  try {
    return fs.readFileSync(tmpPath);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Extracts MP4 bytes + interaction id from an Omni interaction response.
 * @param {OmniClient} client Gemini client.
 * @param {object} interaction Interaction response.
 * @return {Promise<{videoBuffer: Buffer, interactionId: string | null}>} Result.
 */
async function extractVideoFromInteraction(
  client: OmniClient,
  interaction: {
    id?: string;
    output_video?: {data?: string; uri?: string};
    steps?: Array<{content?: unknown[]}>;
  }
): Promise<{videoBuffer: Buffer; interactionId: string | null}> {
  const interactionId =
    typeof interaction.id === "string" && interaction.id.trim() ?
      interaction.id.trim() :
      null;

  const videoOutput = interaction.output_video;
  if (videoOutput?.data) {
    return {videoBuffer: Buffer.from(videoOutput.data, "base64"), interactionId};
  }
  if (videoOutput?.uri) {
    return {
      videoBuffer: await downloadVideoFromUri(client, videoOutput.uri),
      interactionId,
    };
  }

  const steps = interaction.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const content = step.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const p = part as {type?: string; data?: string; uri?: string};
        if (p.type === "video" && p.data) {
          return {videoBuffer: Buffer.from(p.data, "base64"), interactionId};
        }
        if (p.type === "video" && p.uri) {
          return {
            videoBuffer: await downloadVideoFromUri(client, p.uri),
            interactionId,
          };
        }
      }
    }
  }

  throw new Error("Omni did not return video data or a downloadable URI.");
}

/**
 * Generates or edits a video via Gemini Omni Flash Interactions API.
 * @param {object} args Generation inputs.
 * @return {Promise<{videoBuffer: Buffer, interactionId: string | null}>} Result.
 */
async function runOmniVideo(args: {
  apiKey: string;
  promptText: string;
  orientation?: "16:9" | "9:16";
  sourceImageDataUri?: string | null;
  characterImageDataUri?: string | null;
  previousInteractionId?: string | null;
  task: OmniTask;
}): Promise<{videoBuffer: Buffer; interactionId: string | null}> {
  const client = await createOmniClient(args.apiKey);

  const parts: Array<OmniImagePart | OmniTextPart> = [];
  if (args.sourceImageDataUri) {
    parts.push(imagePartFromDataUri(args.sourceImageDataUri));
  }
  if (args.characterImageDataUri) {
    parts.push(imagePartFromDataUri(args.characterImageDataUri));
  }
  parts.push({type: "text", text: args.promptText});

  const input =
    parts.length === 1 && parts[0].type === "text" ? args.promptText : parts;

  const createArgs: Record<string, unknown> = {
    model: MODEL,
    input,
    generationConfig: {
      videoConfig: {
        task: args.task,
      },
    },
  };

  if (args.previousInteractionId) {
    createArgs.previous_interaction_id = args.previousInteractionId;
  }

  if (args.orientation && args.task !== "edit") {
    createArgs.response_format = {
      type: "video",
      aspect_ratio: args.orientation,
      delivery: "uri",
    };
  } else {
    createArgs.response_format = {
      type: "video",
      delivery: "uri",
    };
  }

  const interaction = await client.interactions.create(createArgs);
  return extractVideoFromInteraction(client, interaction);
}

/**
 * Deducts credits or throws; used by generate + edit.
 * @param {DocumentReference} userDocRef User doc.
 * @param {Firestore} adminDb Firestore.
 * @param {string} userId User id.
 * @param {number} cost Credit cost.
 */
async function deductCredits(
  userDocRef: DocumentReference,
  adminDb: Firestore,
  userId: string,
  cost: number
): Promise<void> {
  const rateLimitCutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
  const recentGenerationsSnapshot = await adminDb.collection("generations")
    .where("userId", "==", userId)
    .where("timestamp", ">", rateLimitCutoff)
    .limit(1)
    .get();
  if (!recentGenerationsSnapshot.empty) {
    throw new HttpsError(
      "resource-exhausted",
      `Please wait at least ${RATE_LIMIT_SECONDS} seconds between video generations.`
    );
  }

  try {
    await adminDb.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "User document not found.");
      }
      const userCredits = userDoc.data()?.credits || 0;
      if (userCredits < cost) {
        throw new HttpsError(
          "failed-precondition",
          `Insufficient credits. This costs ${cost} credits.`
        );
      }
      transaction.update(userDocRef, {credits: FieldValue.increment(-cost)});
    });
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    logger.error("Credit transaction failed for user", userId, error);
    throw new HttpsError("internal", "Failed to process user credits.");
  }
}

/**
 * Uploads MP4 buffer and returns a signed URL.
 * @param {object} args Upload args.
 * @return {Promise<string>} Signed URL.
 */
async function uploadVideoBuffer(args: {
  bucket: ReturnType<ReturnType<typeof admin.storage>["bucket"]>;
  userId: string;
  videoBuffer: Buffer;
}): Promise<string> {
  const videoFileName = `${Date.now()}-${uuidv4()}.mp4`;
  const videoFile = args.bucket.file(`generated-scenes/${args.userId}/${videoFileName}`);
  await videoFile.save(args.videoBuffer, {
    metadata: {contentType: "video/mp4"},
  });
  const [signedUrl] = await videoFile.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
  return signedUrl;
}

export const generateScene = onCall({
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [params.GEMINI_API_KEY],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {
    prompt,
    style,
    orientation,
    imageDataUri,
    referenceImageUrl,
    characterId,
  } = request.data;
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
  if (imageDataUri && typeof imageDataUri !== "string") {
    throw new HttpsError("invalid-argument", "If provided, 'imageDataUri' must be a string.");
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const adminDb = admin.firestore();
  const adminStorage = admin.storage();
  const bucketName = params.APP_STORAGE_BUCKET.value();
  const defaultBucket = adminStorage.bucket(bucketName);
  const userDocRef = adminDb.collection("users").doc(userId);

  // Source frame (image-to-video upload) — do not conflate with character portrait.
  const sourceImageDataUri = await resolveReferenceImageDataUri({
    imageDataUri: typeof imageDataUri === "string" ? imageDataUri : undefined,
    bucket: defaultBucket,
    bucketName,
    userId,
  });

  // Character portrait for Omni reference_to_video
  const characterImageDataUri = await resolveReferenceImageDataUri({
    referenceImageUrl:
      typeof referenceImageUrl === "string" ? referenceImageUrl : undefined,
    bucket: defaultBucket,
    bucketName,
    userId,
  });

  await deductCredits(userDocRef, adminDb, userId, VIDEO_COST);

  let sourceImageUrl: string | null = null;

  try {
    const apiKey = params.GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "GEMINI_API_KEY is not configured.");
    }

    if (sourceImageDataUri) {
      const sourceImageFileName = `${Date.now()}-source-${uuidv4()}.jpeg`;
      const sourceImageFile = defaultBucket.file(
        `generated-scenes/${userId}/${sourceImageFileName}`
      );
      const {data} = parseDataUri(sourceImageDataUri);
      await sourceImageFile.save(Buffer.from(data, "base64"), {
        metadata: {contentType: "image/jpeg"},
      });
      const [signedSourceUrl] = await sourceImageFile.getSignedUrl({
        action: "read",
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
      });
      sourceImageUrl = signedSourceUrl;
    }

    let task: OmniTask = "text_to_video";
    let promptText = `A ${style} style video of: ${prompt}.`;

    if (sourceImageDataUri && characterImageDataUri) {
      task = "image_to_video";
      promptText =
        `In a ${style} style: ${prompt}. ` +
        "Animate from the first image. Keep the character's identity and appearance " +
        "consistent with the second reference image.";
    } else if (sourceImageDataUri) {
      task = "image_to_video";
      promptText = `In a ${style} style: ${prompt}`;
    } else if (characterImageDataUri) {
      task = "reference_to_video";
      promptText =
        `In a ${style} style: ${prompt}. ` +
        "Use the reference image as the character/subject identity — keep likeness consistent.";
    }

    logger.info(`Starting Omni ${task} for user ${userId}.`);

    const {videoBuffer, interactionId} = await runOmniVideo({
      apiKey,
      promptText,
      orientation,
      sourceImageDataUri,
      characterImageDataUri,
      task,
    });

    const signedUrl = await uploadVideoBuffer({
      bucket: defaultBucket,
      userId,
      videoBuffer,
    });

    const generationData: Omit<Generation, "id"> = {
      userId,
      prompt,
      style,
      videoUrl: signedUrl,
      timestamp: FieldValue.serverTimestamp() as any,
      orientation: orientation,
      cost: VIDEO_COST,
      sourceImageUrl: sourceImageUrl,
      interactionId: interactionId,
      parentGenerationId: null,
      characterId:
        typeof characterId === "string" && characterId.trim() ?
          characterId.trim() :
          null,
    };
    const generationDocRef = await adminDb.collection("generations").add(generationData);

    const updatedUserDoc = await userDocRef.get();
    const remainingCredits = updatedUserDoc.data()?.credits ?? 0;

    logger.info(`Successfully generated Omni video for user ${userId}`, {
      videoUrl: signedUrl,
      model: MODEL,
      task,
      interactionId,
    });

    return {
      videoUrl: signedUrl,
      generationId: generationDocRef.id,
      interactionId,
      remainingCredits,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Video generation or storage failed for user", userId, {
      errorMessage: message,
      errorStack: error instanceof Error ? error.stack : undefined,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
    });
    try {
      await userDocRef.update({credits: FieldValue.increment(VIDEO_COST)});
      logger.info(`Refunded ${VIDEO_COST} credits to user ${userId} after failure.`);
    } catch (refundError) {
      logger.error(
        `CRITICAL: Failed to refund credits to user ${userId} after video generation failure.`,
        refundError
      );
    }
    throw new HttpsError(
      "internal",
      message || "Failed to generate or save the video. Your credit has been refunded where possible."
    );
  }
});

/**
 * Callable: refine an existing Omni video via conversational edit.
 */
export const editScene = onCall({
  timeoutSeconds: 300,
  memory: "1GiB",
  secrets: [params.GEMINI_API_KEY],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const userId = request.auth.uid;
  const {generationId, editPrompt} = request.data as {
    generationId?: unknown;
    editPrompt?: unknown;
  };

  if (typeof generationId !== "string" || !generationId.trim()) {
    throw new HttpsError("invalid-argument", "generationId is required.");
  }
  const prompt =
    typeof editPrompt === "string" ? editPrompt.trim().slice(0, MAX_EDIT_PROMPT) : "";
  if (!prompt) {
    throw new HttpsError("invalid-argument", "Tell Omni what to change in the video.");
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const adminDb = admin.firestore();
  const adminStorage = admin.storage();
  const bucketName = params.APP_STORAGE_BUCKET.value();
  const defaultBucket = adminStorage.bucket(bucketName);
  const userDocRef = adminDb.collection("users").doc(userId);

  const generationRef = adminDb.collection("generations").doc(generationId.trim());
  const generationSnap = await generationRef.get();
  if (!generationSnap.exists) {
    throw new HttpsError("not-found", "Generation not found.");
  }
  const generation = generationSnap.data() as Generation;
  if (generation.userId !== userId) {
    throw new HttpsError("permission-denied", "Not your generation.");
  }
  if (!generation.videoUrl) {
    throw new HttpsError("failed-precondition", "Only video generations can be edited.");
  }
  if (!generation.interactionId) {
    throw new HttpsError(
      "failed-precondition",
      "This video was generated before Omni editing was available. Generate a new clip to refine it."
    );
  }

  await deductCredits(userDocRef, adminDb, userId, EDIT_COST);

  try {
    const apiKey = params.GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "GEMINI_API_KEY is not configured.");
    }

    logger.info(`Starting Omni edit for user ${userId}`, {
      generationId: generationId.trim(),
      previousInteractionId: generation.interactionId,
    });

    const {videoBuffer, interactionId} = await runOmniVideo({
      apiKey,
      promptText: prompt,
      previousInteractionId: generation.interactionId,
      task: "edit",
      orientation: generation.orientation === "9:16" ? "9:16" : "16:9",
    });

    const signedUrl = await uploadVideoBuffer({
      bucket: defaultBucket,
      userId,
      videoBuffer,
    });

    const generationData: Omit<Generation, "id"> = {
      userId,
      prompt: `Edit: ${prompt}`,
      style: generation.style || "Realistic",
      videoUrl: signedUrl,
      timestamp: FieldValue.serverTimestamp() as any,
      orientation: generation.orientation === "9:16" ? "9:16" : "16:9",
      cost: EDIT_COST,
      sourceImageUrl: generation.sourceImageUrl ?? null,
      interactionId: interactionId ?? generation.interactionId,
      parentGenerationId: generationId.trim(),
      characterId: generation.characterId ?? null,
    };
    const generationDocRef = await adminDb.collection("generations").add(generationData);

    const updatedUserDoc = await userDocRef.get();
    const remainingCredits = updatedUserDoc.data()?.credits ?? 0;

    return {
      videoUrl: signedUrl,
      generationId: generationDocRef.id,
      interactionId: interactionId ?? generation.interactionId,
      remainingCredits,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Video edit failed for user", userId, {
      errorMessage: message,
      generationId,
    });
    try {
      await userDocRef.update({credits: FieldValue.increment(EDIT_COST)});
      logger.info(`Refunded ${EDIT_COST} credits to user ${userId} after edit failure.`);
    } catch (refundError) {
      logger.error(
        `CRITICAL: Failed to refund credits to user ${userId} after video edit failure.`,
        refundError
      );
    }
    throw new HttpsError(
      "internal",
      message || "Failed to edit the video. Your credit has been refunded where possible."
    );
  }
});
