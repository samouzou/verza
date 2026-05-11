
import * as dotenv from 'dotenv';
import { scrapeCreatorProfile } from './scraper';
import { analyzeProfileWithGemini } from './vision';
import { saveLeadToFirestore } from './storage';

dotenv.config();

/**
 * Main execution pipeline for Verza Optic.
 */
async function main() {
  // Hardcoded test URL as requested for the MVP
  // You can change this to any creator profile (YouTube/Instagram/TikTok)
  const testUrl = process.argv[2] || "https://www.youtube.com/@mkbhd/about";

  console.log(`\n--- [Verza Optic: Agentic Discovery] ---`);
  console.log(`Target: ${testUrl}\n`);

  try {
    // 1. Scrape
    const imageBase64 = await scrapeCreatorProfile(testUrl);

    // 2. Analyze
    const leadData = await analyzeProfileWithGemini(imageBase64);

    // 3. Save
    await saveLeadToFirestore(leadData, testUrl);

    console.log(`\n--- [Pipeline Success] ---\n`);
  } catch (error) {
    console.error(`\n--- [Pipeline Failed] ---`);
    console.error(error);
    process.exit(1);
  }
}

// Run the pipeline
main();
