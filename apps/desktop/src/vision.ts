
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface GeminiAnalysisResult {
  creatorName: string;
  niche: string;
  email?: string;
  followerCount: string;
  draftEmail?: string;
}

/**
 * Passes a base64 image to Gemini for multimodal analysis.
 * @param imageBase64 The profile screenshot.
 * @param objectives The user's campaign objectives for personalization.
 */
export async function analyzeProfileWithGemini(
  imageBase64: string, 
  objectives: string = "general outreach"
): Promise<GeminiAnalysisResult> {
  console.log(`[Optic] Analyzing screenshot with Gemini (Context: ${objectives})...`);
  
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const prompt = `
    You are an elite marketing agent powering Verza Optic. 
    Analyze this screenshot of a creator's profile based on the following Campaign Objectives:
    "${objectives}"

    Extract the following information and return it strictly as a JSON object:
    1. creatorName 
    2. niche (e.g., tech, beauty, gaming) 
    3. email (if visible in the bio or description) 
    4. followerCount (estimate based on visible numbers)
    
    If an email is found, also generate a draftEmail string: 
    A short, 3-sentence personalized pitch inviting them to join the Verza network. 
    The pitch must align with the provided Campaign Objectives and mention their specific niche.

    Do not include any markdown formatting outside of the JSON. 
    If you cannot find a piece of information, return null for that field.
  `;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/png"
        }
      }
    ]);

    const response = await result.response;
    const text = response.text().trim();
    
    // Simple regex to extract JSON if Gemini wraps it in code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract valid JSON from Gemini response");
    }

    const parsedData: GeminiAnalysisResult = JSON.parse(jsonMatch[0]);
    console.log(`[Optic] Analysis complete for: ${parsedData.creatorName}`);
    
    return parsedData;
  } catch (error) {
    console.error(`[Optic] Vision error:`, error);
    throw error;
  }
}
