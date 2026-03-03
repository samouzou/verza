
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import axios from "axios";
import {db} from "../config/firebase";
import * as params from "../config/params";

/**
 * syncInstagramStats - Exchanges a client token for real IG data.
 * Pulls follower count, engagement, and content captions for AI analysis.
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

    const pages = pagesResponse.data?.data;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      logger.warn("No Facebook Pages found for user.");
      throw new HttpsError("not-found", 
        "No Facebook Pages found. Ensure you have a Facebook Page linked to your professional Instagram account.");
    }

    const pageWithIg = pages.find((p: any) => p.instagram_business_account);

    if (!pageWithIg) {
      logger.warn("No linked Instagram Business account found in Pages.");
      throw new HttpsError("not-found",
        "No Instagram Business account found linked to your Facebook Pages." +
        " Please ensure your Instagram is a 'Business' or 'Creator' account and is connected to a Facebook Page.");
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
    const followers = userResponse.data?.followers_count || 0;

    // 3. Get Engagement Data & Captions from last 10 posts
    const mediaResponse = await axios.get(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      params: {
        fields: "id,like_count,comments_count,caption",
        limit: 10,
        access_token: accessToken,
      },
    });

    const mediaItems = mediaResponse.data?.data || [];
    let totalLikes = 0;
    let totalComments = 0;
    let concatenatedCaptions = "";

    mediaItems.forEach((item: any) => {
      totalLikes += (item.like_count || 0);
      totalComments += (item.comments_count || 0);
      if (item.caption) {
        concatenatedCaptions += item.caption + " | ";
      }
    });

    // 4. Calculate Average Engagement Rate
    const totalInteractions = totalLikes + totalComments;
    const postCount = mediaItems.length || 1;
    const avgInteractionsPerPost = totalInteractions / postCount;

    let engagementRateValue = 0;
    if (followers > 0) {
      engagementRateValue = (avgInteractionsPerPost / followers) * 100;
    }

    const finalEngagementRate = parseFloat(engagementRateValue.toFixed(2));

    // 5. Save to Firestore
    const userDocRef = db.collection("users").doc(request.auth.uid);
    const statsUpdate = {
      instagramConnected: true,
      followers: followers,
      engagementRate: finalEngagementRate,
      lastSocialSync: new Date().toISOString(),
      ["socialContent.instagram"]: concatenatedCaptions.trim(),
    };

    await userDocRef.update(statsUpdate);

    logger.info(`Synced IG stats for user ${request.auth.uid}: ${followers} followers, ${finalEngagementRate}% engagement.`);

    return {
      success: true,
      followers: followers,
      engagementRate: finalEngagementRate,
    };
  } catch (error: any) {
    logger.error("Instagram sync failed:", error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Instagram Sync Error: ${error.message}`);
  }
});

/**
 * syncYouTubeStats - Exchanges a Google access token for real YT data.
 * Pulls subscriber count, engagement, and video metadata for AI analysis.
 */
export const syncYouTubeStats = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {accessToken} = request.data;
  if (!accessToken) {
    throw new HttpsError("invalid-argument", "A Google access token is required.");
  }

  try {
    logger.info(`Starting YouTube sync for user: ${request.auth.uid}`);

    // 1. Get Channel Stats (Subscriber Count)
    const channelResponse = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params: {
        part: "statistics",
        mine: true,
        access_token: accessToken,
      },
    });

    const channel = channelResponse.data?.items?.[0];
    if (!channel) {
      throw new HttpsError("not-found", "No YouTube channel found for this account.");
    }

    const subscribers = parseInt(channel.statistics.subscriberCount) || 0;

    // 2. Get Last 10 Videos via Activities
    const activitiesResponse = await axios.get("https://www.googleapis.com/youtube/v3/activities", {
      params: {
        part: "contentDetails,snippet",
        mine: true,
        maxResults: 10,
        access_token: accessToken,
      },
    });

    const items = activitiesResponse.data?.items || [];
    const videoIds = items
      .filter((a: any) => a.contentDetails?.upload?.videoId)
      .map((a: any) => a.contentDetails.upload.videoId);

    // Collect titles and descriptions for AI analysis
    let concatenatedMetadata = "";
    items.forEach((item: any) => {
      if (item.snippet) {
        concatenatedMetadata += `${item.snippet.title}: ${item.snippet.description} | `;
      }
    });

    if (videoIds.length === 0) {
      const userDocRef = db.collection("users").doc(request.auth.uid);
      await userDocRef.update({
        youtubeConnected: true,
        followers: subscribers,
        lastSocialSync: new Date().toISOString(),
        ["socialContent.youtube"]: concatenatedMetadata.trim(),
      });
      return {success: true, followers: subscribers, engagementRate: 0};
    }

    // 3. Get Statistics for those Videos
    const videosResponse = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        part: "statistics",
        id: videoIds.join(","),
        access_token: accessToken,
      },
    });

    const videoStats = videosResponse.data?.items || [];
    let totalInteractions = 0;

    videoStats.forEach((v: any) => {
      const likes = parseInt(v.statistics.likeCount) || 0;
      const comments = parseInt(v.statistics.commentCount) || 0;
      totalInteractions += (likes + comments);
    });

    // 4. Calculate Average Engagement Rate
    const postCount = videoStats.length || 1;
    const avgInteractionsPerVideo = totalInteractions / postCount;
    let engagementRateValue = 0;
    if (subscribers > 0) {
      engagementRateValue = (avgInteractionsPerVideo / subscribers) * 100;
    }

    const finalEngagementRate = parseFloat(engagementRateValue.toFixed(2));

    // 5. Save to Firestore
    const userDocRef = db.collection("users").doc(request.auth.uid);
    const statsUpdate = {
      youtubeConnected: true,
      followers: subscribers,
      engagementRate: finalEngagementRate,
      lastSocialSync: new Date().toISOString(),
      ["socialContent.youtube"]: concatenatedMetadata.trim(),
    };

    await userDocRef.update(statsUpdate);

    logger.info(`Synced YouTube stats for user ${request.auth.uid}: ${subscribers} subs, ${finalEngagementRate}% engagement.`);

    return {
      success: true,
      followers: subscribers,
      engagementRate: finalEngagementRate,
    };
  } catch (error: any) {
    logger.error("YouTube sync failed:", error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `YouTube Sync Error: ${error.message}`);
  }
});

/**
 * syncTikTokStats - Exchanges a TikTok code for real stats.
 */
export const syncTikTokStats = onCall({
  secrets: [params.TIKTOK_CLIENT_SECRET],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const {authCode} = request.data;
  if (!authCode) {
    throw new HttpsError("invalid-argument", "TikTok auth code is required.");
  }

  const clientKey = params.TIKTOK_CLIENT_KEY.value();
  const clientSecret = params.TIKTOK_CLIENT_SECRET.value();
  const redirectUri = params.APP_URL.value() + "/insights";

  try {
    logger.info(`Starting TikTok sync for user: ${request.auth.uid}`);

    // 1. Exchange code for access token
    const tokenResponse = await axios.post("https://open.tiktokapis.com/v2/oauth/token/",
      new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code: authCode,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
      {headers: {"Content-Type": "application/x-www-form-urlencoded"}}
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error("Failed to obtain TikTok access token.");
    }

    // 2. Get User Info & Stats
    const userResponse = await 
      axios.get("https://open.tiktokapis.com/v2/user/info/?fields=follower_count,display_name,avatar_url", {
      headers: {"Authorization": `Bearer ${accessToken}`},
    });

    const tiktokUser = userResponse.data.data.user;
    const followerCount = tiktokUser.follower_count || 0;

    // 3. Get Video List for content metadata
    const videoResponse = await axios.get("https://open.tiktokapis.com/v2/video/list/?fields=title,video_description", {
      headers: {"Authorization": `Bearer ${accessToken}`},
    });

    const videos = videoResponse.data.data.videos || [];
    let concatenatedMetadata = "";
    videos.forEach((v: any) => {
      if (v.video_description) {
        concatenatedMetadata += `${v.title || "Video"}: ${v.video_description} | `;
      }
    });

    // 4. Update Firestore
    const userDocRef = db.collection("users").doc(request.auth.uid);
    await userDocRef.update({
      tiktokConnected: true,
      followers: followerCount,
      lastSocialSync: new Date().toISOString(),
      ["socialContent.tiktok"]: concatenatedMetadata.trim(),
    });

    logger.info(`Synced TikTok stats for ${request.auth.uid}: ${followerCount} followers.`);

    return {
      success: true,
      followers: followerCount,
    };
  } catch (error: any) {
    logger.error("TikTok sync failed:", error.message, error.response?.data);
    throw new HttpsError("internal", `TikTok Sync Error: ${error.message}`);
  }
});
