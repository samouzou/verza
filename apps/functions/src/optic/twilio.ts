import twilio from "twilio";
import * as logger from "firebase-functions/logger";
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} from "../config/params";

/**
 * Normalizes a phone string to E.164 when possible.
 * @param {string} raw User-entered or Twilio phone value.
 * @return {?string} E.164 number or null if invalid.
 */
export function normalizeSmsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

/**
 * True when Twilio account SID, auth token, and from-number are configured.
 * @return {boolean} Whether outbound SMS can be sent.
 */
function twilioReady(): boolean {
  return Boolean(
    TWILIO_ACCOUNT_SID.value().trim() &&
      TWILIO_AUTH_TOKEN.value().trim() &&
      TWILIO_PHONE_NUMBER.value().trim()
  );
}

/**
 * Sends a plain-text SMS from Verza Optic.
 * @param {string} to Destination phone.
 * @param {string} body Message body (prefixed with Verza Optic when missing).
 * @return {Promise<boolean>} True if Twilio accepted the message.
 */
export async function sendOpticSms(to: string, body: string): Promise<boolean> {
  if (!twilioReady()) {
    logger.warn("[Optic SMS] Twilio not configured; skipping send.");
    return false;
  }
  const toNorm = normalizeSmsPhone(to);
  if (!toNorm) {
    logger.warn("[Optic SMS] Invalid destination phone.");
    return false;
  }
  const client = twilio(TWILIO_ACCOUNT_SID.value().trim(), TWILIO_AUTH_TOKEN.value());
  try {
    await client.messages.create({
      body: body.startsWith("Verza Optic:") ? body : `Verza Optic: ${body}`,
      from: TWILIO_PHONE_NUMBER.value().trim(),
      to: toNorm,
    });
    return true;
  } catch (e) {
    logger.error("[Optic SMS] Send failed", {error: e instanceof Error ? e.message : String(e)});
    return false;
  }
}

/**
 * Validates an inbound Twilio webhook signature.
 * @param {string|undefined} signature X-Twilio-Signature header value.
 * @param {string} url Full request URL Twilio signed.
 * @param {Object.<string, string>} params POST body fields.
 * @return {boolean} True if the signature is valid.
 */
export function validateTwilioWebhook(
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signature || !twilioReady()) return false;
  return twilio.validateRequest(
    TWILIO_AUTH_TOKEN.value().trim(),
    signature,
    url,
    params
  );
}
