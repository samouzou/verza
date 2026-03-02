
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
    // 1. Get the Instagram Business Account ID via linked Pages
    // Endpoint: GET /me/accounts?fields=instagram_business_account
    const pagesResponse = await axios.get("https://graph.facebook.com/v20.0/me/accounts", {
      params: {
        fields: "instagram_business_account,name",
        access_token: accessToken,
      },
    });

    const pages = pagesResponse.data.data;
    const pageWithIg = pages.find((p: any) => p.instagram_business_account);

    if (!pageWithIg) {
      throw new HttpsError("not-found",
        "No Instagram Business account found linked to your Facebook Pages." +
        " Ensure your IG account is professional and linked to a Page.");
    }

    const igUserId = pageWithIg.instagram_business_account.id;

    // 2. Get Follower Count
    // Endpoint: GET /{ig-user-id}?fields=followers_count
    const userResponse = await axios.get(`https://graph.facebook.com/v20.0/${igUserId}`, {
      params: {
        fields: "followers_count",
        access_token: accessToken,
      },
    });
    const followers = userResponse.data.followers_count || 0;

    // 3. Get Engagement Data (Likes & Comments) from last 10 posts
    // Endpoint: GET /{ig-user-id}/media?fields=like_count,comments_count&limit=10
    const mediaResponse = await axios.get(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      params: {
        fields: "like_count,comments_count",
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
    // Formula: [(Total Likes + Total Comments on last 10 posts) / 10] / Total Followers * 100
    const totalInteractions = totalLikes + totalComments;
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

    logger.info(`Synced IG stats for user ${request.auth.uid}: ${followers} followers,
      ${engagementRate.toFixed(2)}% engagement.`);

    return {
      success: true,
      followers,
      engagementRate: parseFloat(engagementRate.toFixed(2)),
    };
  } catch (error: any) {
    logger.error("Instagram sync failed:", error.response?.data || error.message);
    const fbError = error.response?.data?.error?.message || "Internal error during Instagram sync.";
    throw new HttpsError("internal", fbError);
  }
});
