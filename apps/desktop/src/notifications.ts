import twilio from "twilio";
import * as dotenv from "dotenv";
import { logger } from "./logger";
import { isSmsPerLeadDisabled } from "./config";

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const userNumber = process.env.USER_PHONE_NUMBER;

let twilioClient: ReturnType<typeof twilio> | null = null;

function getTwilioClient(): ReturnType<typeof twilio> | null {
  if (!accountSid || !authToken) return null;
  if (!twilioClient) twilioClient = twilio(accountSid, authToken);
  return twilioClient;
}

/**
 * Sends an SMS notification to the user.
 * @param message The body of the text message.
 */
export async function sendSmsNotification(message: string) {
  if (isSmsPerLeadDisabled()) {
    logger.log(`[Optic] SMS suppressed (OPTIC_DISABLE_SMS).`);
    return;
  }
  if (!accountSid || !authToken || !twilioNumber || !userNumber) {
    logger.warn(`[Optic] Twilio credentials missing. Skipping SMS.`);
    return;
  }

  const client = getTwilioClient();
  if (!client) {
    logger.warn(`[Optic] Twilio client unavailable. Skipping SMS.`);
    return;
  }

  try {
    const response = await client.messages.create({
      body: `[Optic] ${message}`,
      from: twilioNumber,
      to: userNumber
    });
    logger.log(`[Optic] SMS sent: ${response.sid}`);
  } catch (error) {
    logger.error(`[Optic] Twilio error:`, error);
  }
}
