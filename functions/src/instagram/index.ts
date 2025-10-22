
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

/**
 * Creates the authorization URL for the user to grant Instagram permissions.
 */
export const getInstagramAuthUrl = onCall((request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const clientId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    logger.error("Instagram app credentials are not configured in environment variables.");
    throw new HttpsError("failed-precondition", "The Instagram integration is not configured on the server.");
  }

  const scope = "user_profile,user_media";
  const responseType = "code";

  const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=${responseType}`;

  logger.info(`Generated Instagram auth URL for user: ${request.auth.uid}`);
  return { authUrl };
});
