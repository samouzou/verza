/** Legal entity for SMS / toll-free compliance (TFV, A2P). */
export const SMS_LEGAL_ENTITY = "Verza Technologies, Inc.";

export const SMS_PRIVACY_POLICY_URL = "https://www.tryverza.com/privacy-policy";
export const SMS_TERMS_URL = "https://www.tryverza.com/terms-of-service";

/**
 * Full label next to the opt-in checkbox (unchecked by default for new users).
 * Transactional / account-activity framing only — no marketing language.
 */
export const SMS_OPT_IN_CHECKBOX_LABEL = `I agree to receive account-related and transactional text messages from ${SMS_LEGAL_ENTITY} about Verza Optic (for example, when a discovery batch completes). Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help.`;

/** Shown under the checkbox — clarifies SMS is optional. */
export const SMS_OPT_IN_NOT_REQUIRED =
  "Consent is not a condition of purchase or of using Verza or Optic. You can use Optic without text messages.";
