import {defineString, defineSecret} from "firebase-functions/params";

// --- Secrets (backed by Secret Manager) ---
// To set these secrets, run `firebase functions:secrets:set <SECRET_NAME>`
// e.g., `firebase functions:secrets:set STRIPE_SECRET_KEY` and enter the value.
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
export const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
export const HELLOSIGN_API_KEY = defineSecret("HELLOSIGN_API_KEY");
export const FINICITY_PARTNER_SECRET = defineSecret("FINICITY_PARTNER_SECRET");
export const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
export const STRIPE_ACCOUNT_WEBHOOK_SECRET = defineSecret("STRIPE_ACCOUNT_WEBHOOK_SECRET");
export const STRIPE_SUBSCRIPTION_WEBHOOK_SECRET = defineSecret("STRIPE_SUBSCRIPTION_WEBHOOK_SECRET");
export const STRIPE_CREDIT_PURCHASE_WEBHOOK_SECRET = defineSecret("STRIPE_CREDIT_PURCHASE_WEBHOOK_SECRET");
export const VERTEX_API_KEY = defineSecret("VERTEX_API_KEY");
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");


// --- String Parameters (can be set as env vars in .env file for local emulation) ---
export const APP_URL = defineString("APP_URL", {
  description: "The base URL of the web application.",
  default: "https://app.tryverza.com",
});

export const FINICITY_PARTNER_ID = defineString("FINICITY_PARTNER_ID");
export const FINICITY_APP_KEY = defineString("FINICITY_APP_KEY");
export const FINICITY_EXPERIENCE_GUID = defineString("FINICITY_EXPERIENCE_GUID");
export const FINICITY_WEBHOOK_URL = defineString("FINICITY_WEBHOOK_URL");

export const SENDGRID_FROM_EMAIL = defineString("SENDGRID_FROM_EMAIL", {
  default: "invoices@tryverza.com",
  description: "The 'from' email address for automated emails.",
});

export const APP_STORAGE_BUCKET = defineString("APP_STORAGE_BUCKET", {
  description: "The default Firebase Storage bucket name.",
});


// --- Stripe Price IDs ---
export const STRIPE_INDIVIDUAL_PRO_PRICE_ID = defineString("STRIPE_INDIVIDUAL_PRO_PRICE_ID");
export const STRIPE_INDIVIDUAL_PRO_YEARLY_PRICE_ID = defineString("STRIPE_INDIVIDUAL_PRO_YEARLY_PRICE_ID");
export const STRIPE_AGENCY_START_PRICE_ID = defineString("STRIPE_AGENCY_START_PRICE_ID");
export const STRIPE_AGENCY_START_YEARLY_PRICE_ID = defineString("STRIPE_AGENCY_START_YEARLY_PRICE_ID");
export const STRIPE_AGENCY_PRO_PRICE_ID = defineString("STRIPE_AGENCY_PRO_PRICE_ID");
export const STRIPE_AGENCY_PRO_YEARLY_PRICE_ID = defineString("STRIPE_AGENCY_PRO_YEARLY_PRICE_ID");
export const STRIPE_SCENE_SPAWNER_STARTER_PRICE_ID = defineString("STRIPE_SCENE_SPAWNER_STARTER_PRICE_ID");
export const STRIPE_SCENE_SPAWNER_AGENCY_PRICE_ID = defineString("STRIPE_SCENE_SPAWNER_AGENCY_PRICE_ID");
