
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import axios from "axios";
import {db} from "../config/firebase";

/**
 * syncInstagramStats - Exchanges a client token for real IG data.
 * Calculates engagement based on the last 10 posts.
 */
export const syncInstagramStats = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {accessToken} = request.data;
  if (!accessToken) {
    throw new HttpsError("invalid-argument", "A Facebook access token is required.");
  }

  try {
    logger.info(`Starting IG sync for user: ${request.auth.uid}`);

    // 1. Get the Instagram Business Account ID via linked Pages
    const pagesResponse = await axios.get("https://graph.facebook.com/v20.0/me/accounts", {
      params: {
        fields: "instagram_business_account,name",
        access_token: accessToken,
      },
    });

    const pages = pagesResponse.data.data;
    if (!pages || pages.length === 0) {
      logger.warn("No Facebook Pages found for user.");
      throw new HttpsError("not-found", "No Facebook Pages found. Ensure you have a Page linked to your IG account.");
    }

    const pageWithIg = pages.find((p: any) => p.instagram_business_account);

    if (!pageWithIg) {
      logger.warn("No linked Instagram Business account found in Pages.");
      throw new HttpsError("not-found", "No Instagram Business account found linked to your Facebook Pages. Ensure your IG account is professional (Business or Creator) and linked to a Page.");
    }

    const igUserId = pageWithIg.instagram_business_account.id;
    logger.info(`Found IG User ID: ${igUserId} from Page: ${pageWithIg.name}`);

    // 2. Get Follower Count
    const userResponse = await axios.get(`https://graph.facebook.com/v20.0/${igUserId}`, {
      params: {
        fields: "followers_count",
        access_token: accessToken,
      },
    });
    const followers = userResponse.data.followers_count || 0;

    // 3. Get Engagement Data (Likes & Comments) from last 10 posts
    const mediaResponse = await axios.get(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      params: {
        fields: "id,like_count,comments_count",
        limit: 10,
        access_token: accessToken,
      },
    });

    const mediaItems = mediaResponse.data.data || [];
    let totalLikes = 0;
    let totalComments = 0;

    mediaItems.forEach((item: any) => {
      totalLikes += (item.like_count || 0);
      totalComments += (item.comments_count || 0);
    });

    // 4. Calculate Average Engagement Rate
    const totalInteractions = totalLikes + totalComments;
    // Divide by 10 as per prompt requirement for "Average Engagement Rate" based on a 10-post sample
    const avgInteractionsPerPost = totalInteractions / 10;

    let engagementRate = 0;
    if (followers > 0) {
      engagementRate = (avgInteractionsPerPost / followers) * 100;
    }

    // 5. Save to Firestore
    const userDocRef = db.collection("users").doc(request.auth.uid);
    const statsUpdate = {
      instagramConnected: true,
      followers: followers,
      engagementRate: parseFloat(engagementRate.toFixed(2)),
      lastSocialSync: new Date().toISOString(),
    };

    await userDocRef.update(statsUpdate);

    logger.info(`Synced IG stats for user ${request.auth.uid}: ${followers} followers, ${engagementRate.toFixed(2)}% engagement.`);

    return {
      success: true,
      followers,
      engagementRate: parseFloat(engagementRate.toFixed(2)),
    };
  } catch (error: any) {
    // Log the full error for backend debugging
    logger.error("Instagram sync failed with error:", {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });

    // If it's already an HttpsError, rethrow it
    if (error instanceof HttpsError) {
      throw error;
    }

    // Otherwise, construct a useful message from FB's response if available
    const fbErrorMsg = error.response?.data?.error?.message || error.message || "Internal error during Instagram sync.";
    throw new HttpsError("internal", `Instagram Sync Error: ${fbErrorMsg}`);
  }
});
