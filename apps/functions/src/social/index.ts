
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import axios from "axios";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {
  extractYouTubeVideoId,
  fetchYouTubeVideoStatsById,
} from "./youtubeVideo";

const GRAPH = "https://graph.facebook.com/v20.0";
const META_APP_ID = "1903627140270068";

type GrantedAssets = {pageIds: string[]; igIds: string[]};

/**
 * Pages and Instagram accounts the user checked in the Facebook dialog.
 * /me/accounts is empty for a Page owned by a Business portfolio, even after that check.
 * @param {string} userToken Login token.
 * @return {!Promise<GrantedAssets>} Granted ids.
 */
async function grantedAssets(userToken: string): Promise<GrantedAssets> {
  const pageIds = new Set<string>();
  const igIds = new Set<string>();
  try {
    const appToken = `${META_APP_ID}|${params.FACEBOOK_APP_SECRET.value()}`;
    const debug = await axios.get(`${GRAPH}/debug_token`, {
      params: {input_token: userToken, access_token: appToken},
    });
    const scopes = debug.data?.data?.granular_scopes ?? [];
    for (const scope of scopes) {
      const ids = Array.isArray(scope?.target_ids) ? scope.target_ids.map(String) : [];
      if (scope?.scope === "pages_show_list" || scope?.scope === "pages_read_engagement") {
        ids.forEach((id: string) => pageIds.add(id));
      }
      if (scope?.scope === "instagram_basic") ids.forEach((id: string) => igIds.add(id));
    }
  } catch (error: any) {
    logger.warn("Could not read granted Facebook assets", error?.response?.data?.error?.message || error.message);
  }
  return {pageIds: [...pageIds], igIds: [...igIds]};
}

/**
 * Finds the Instagram professional account behind this login.
 * @param {string} userToken Login token.
 * @return {!Promise<{igUserId: string, pageName: string}>} Account to sync.
 */
async function resolveInstagramAccount(userToken: string): Promise<{igUserId: string; pageName: string}> {
  let listed: Array<{name?: string; instagram_business_account?: {id?: string}}> = [];
  try {
    const accounts = await axios.get(`${GRAPH}/me/accounts`, {
      params: {
        fields: "id,name,instagram_business_account{id}",
        limit: "50",
        access_token: userToken,
      },
    });
    listed = Array.isArray(accounts.data?.data) ? accounts.data.data : [];
  } catch (error: any) {
    logger.warn("me/accounts failed", error?.response?.data?.error?.message || error.message);
  }
  const fromList = listed.find((page: {instagram_business_account?: {id?: string}}) => page.instagram_business_account?.id);
  if (fromList?.instagram_business_account?.id) {
    return {igUserId: String(fromList.instagram_business_account.id), pageName: fromList.name || "Facebook Page"};
  }

  const granted = await grantedAssets(userToken);
  for (const pageId of granted.pageIds) {
    try {
      const page = await axios.get(`${GRAPH}/${pageId}`, {
        params: {fields: "id,name,instagram_business_account{id}", access_token: userToken},
      });
      const igId = page.data?.instagram_business_account?.id;
      if (igId) return {igUserId: String(igId), pageName: page.data?.name || "Facebook Page"};
    } catch (error: any) {
      logger.warn(`Page ${pageId} did not return an Instagram account`, error?.response?.data?.error?.message || error.message);
    }
  }
  if (granted.igIds.length > 0) {
    return {igUserId: granted.igIds[0], pageName: "Instagram"};
  }

  if (listed.length === 0 && granted.pageIds.length === 0) {
    throw new HttpsError("not-found",
      "Facebook did not share a Page on this login. In the Facebook window, " +
      "select the Page that has your Instagram account connected, then continue.");
  }
  throw new HttpsError("not-found",
    "That Facebook Page does not have an Instagram professional account connected to it.");
}

/**
 * syncInstagramStats - Exchanges a client token for real IG data.
 * Pulls follower count, engagement, and content captions for AI analysis.
 */
export const syncInstagramStats = onCall({secrets: [params.FACEBOOK_APP_SECRET]}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {accessToken} = request.data;
  if (!accessToken) {
    throw new HttpsError("invalid-argument", "A Facebook access token is required.");
  }

  try {
    logger.info(`Starting IG sync for user: ${request.auth.uid}`);

    const {igUserId, pageName} = await resolveInstagramAccount(accessToken);
    logger.info(`Found IG User ID: ${igUserId} from Page: ${pageName}`);

    // 2. Get Follower Count
    const userResponse = await axios.get(`https://graph.facebook.com/v20.0/${igUserId}`, {
      params: {
        fields: "followers_count,username",
        access_token: accessToken,
      },
    });
    const followersCountValue = userResponse.data?.followers_count || 0;
    const instagramUsername = typeof userResponse.data?.username === "string" ?
      userResponse.data.username.replace(/^@/, "").trim() : "";

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
    if (followersCountValue > 0) {
      engagementRateValue = (avgInteractionsPerPost / followersCountValue) * 100;
    }

    const finalEngagementRate = parseFloat(engagementRateValue.toFixed(2));

    // 5. Save to Firestore
    const userDocRef = db.collection("users").doc(request.auth.uid);
    const statsUpdate = {
      instagramConnected: true,
      instagramFollowers: followersCountValue,
      instagramEngagement: finalEngagementRate,
      instagramUsername: instagramUsername || null,
      // For legacy/general view
      followers: followersCountValue,
      engagementRate: finalEngagementRate,
      lastSocialSync: new Date().toISOString(),
      ["socialContent.instagram"]: concatenatedCaptions.trim(),
    };

    await userDocRef.update(statsUpdate);

    logger.info(`Synced IG stats for user ${request.auth.uid}: ${followersCountValue} followers,
      ${finalEngagementRate}% engagement.`);

    return {
      success: true,
      followers: followersCountValue,
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
        part: "snippet,statistics",
        mine: true,
        access_token: accessToken,
      },
    });

    const channel = channelResponse.data?.items?.[0];
    if (!channel) {
      throw new HttpsError("not-found", "No YouTube channel found for this account.");
    }

    const subscribers = parseInt(channel.statistics.subscriberCount) || 0;
    const youtubeChannelId = typeof channel.id === "string" ? channel.id : null;
    const customUrl = typeof channel.snippet?.customUrl === "string" ? channel.snippet.customUrl : "";
    const youtubeHandle = customUrl.replace(/^@/, "").trim() || null;

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
        youtubeFollowers: subscribers,
        youtubeEngagement: 0,
        youtubeChannelId,
        youtubeHandle,
        followers: subscribers,
        engagementRate: 0,
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
      youtubeFollowers: subscribers,
      youtubeEngagement: finalEngagementRate,
      youtubeChannelId,
      youtubeHandle,
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
 * fetchYouTubeVideoStats - Public video statistics for YouTube link submissions.
 * Uses YouTube Data API v3 (videos.list) with a server API key.
 */
export const fetchYouTubeVideoStats = onCall({
  secrets: [params.YOUTUBE_API_KEY],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const {videoUrl} = request.data ?? {};
  if (!videoUrl || typeof videoUrl !== "string") {
    throw new HttpsError("invalid-argument", "A YouTube video URL is required.");
  }

  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    throw new HttpsError("invalid-argument", "Invalid YouTube URL.");
  }

  const apiKey = params.YOUTUBE_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "YouTube Data API is not configured on the server."
    );
  }

  try {
    const stats = await fetchYouTubeVideoStatsById(videoId, apiKey);
    logger.info(`Fetched YouTube stats for ${videoId} (user ${request.auth.uid})`);
    return stats;
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("fetchYouTubeVideoStats failed:", message);
    throw new HttpsError("internal", `YouTube stats error: ${message}`);
  }
});

/**
 * syncTikTokStats - Exchanges a TikTok code for real stats.
 * Following V2 Web Auth flow: https://developers.tiktok.com/doc/login-kit-web
 */
export const syncTikTokStats = onCall({
  secrets: [params.TIKTOK_CLIENT_SECRET],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const {authCode, redirectUri} = request.data;
  if (!authCode) {
    throw new HttpsError("invalid-argument", "TikTok auth code is required.");
  }
  if (!redirectUri) {
    throw new HttpsError("invalid-argument", "Redirect URI is required for verification.");
  }

  const clientKey = params.TIKTOK_CLIENT_KEY.value();
  const clientSecret = params.TIKTOK_CLIENT_SECRET.value();

  logger.info(`TikTok Sync: Exchange for user ${request.auth.uid}. Client Key: ${clientKey}`);

  try {
    // 1. Exchange code for access token - Use V2 endpoint with mandatory trailing slash
    const tokenParams = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: authCode,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const tokenResponse = await axios.post("https://open.tiktokapis.com/v2/oauth/token/",
      tokenParams.toString(),
      {headers: {"Content-Type": "application/x-www-form-urlencoded"}}
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      logger.error("TikTok token exchange failed. Response data:", tokenResponse.data);
      throw new Error(`Failed to obtain TikTok access token. ${tokenResponse.data?.error_description || "Check logs"}`);
    }

    // 2. Get User Info - V2 Endpoint with trailing slash
    const tiktokAuth = {headers: {"Authorization": `Bearer ${accessToken}`}};
    let userResponse;
    try {
      userResponse = await axios.get(
        "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,display_name,avatar_url,username",
        tiktokAuth
      );
    } catch (usernameErr: any) {
      logger.warn(
        "TikTok username field unavailable, retrying without it",
        usernameErr?.response?.data || usernameErr.message
      );
      userResponse = await axios.get(
        "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,display_name,avatar_url",
        tiktokAuth
      );
    }

    const userData = userResponse.data?.data?.user;
    if (!userData) {
      logger.error("TikTok user data missing. Response data:", userResponse.data);
      throw new Error("TikTok user data not found.");
    }

    const followers = userData.follower_count || 0;
    const tiktokUsername = typeof userData.username === "string" ?
      userData.username.replace(/^@/, "").trim() : "";

    // 3. Get Video List - V2 Endpoint is a POST request
    const videoResponse = await axios.post(
      "https://open.tiktokapis.com/v2/video/list/",
      {}, // V2 POST request for video list requires an empty JSON body if no filters
      {
        params: {
          fields: "title,video_description,like_count,comment_count,share_count",
        },
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const videos = videoResponse.data?.data?.videos || [];
    let totalInteractions = 0;
    let concatenatedMetadata = "";

    videos.forEach((v: any) => {
      // V2 fields are typically top-level, but adding fallback for robustness
      const likes = v.like_count ?? v.statistics?.like_count ?? 0;
      const comments = v.comment_count ?? v.statistics?.comment_count ?? 0;
      const shares = v.share_count ?? v.statistics?.share_count ?? 0;

      totalInteractions += (likes + comments + shares);

      if (v.video_description) {
        concatenatedMetadata += `${v.title || "Video"}: ${v.video_description} | `;
      }
    });

    // 4. Calculate Average Engagement Rate
    const postCount = videos.length;
    let finalEngagementRate = 0;

    if (followers > 0 && postCount > 0) {
      const avgInteractionsPerVideo = totalInteractions / postCount;
      finalEngagementRate = parseFloat(((avgInteractionsPerVideo / followers) * 100).toFixed(2));
    }

    // 5. Update Firestore
    const userDocRef = db.collection("users").doc(request.auth.uid);
    const statsUpdate = {
      tiktokConnected: true,
      tiktokFollowers: followers,
      tiktokEngagement: finalEngagementRate,
      tiktokUsername: tiktokUsername || null,
      followers: followers,
      engagementRate: finalEngagementRate,
      lastSocialSync: new Date().toISOString(),
      ["socialContent.tiktok"]: concatenatedMetadata.trim(),
    };

    await userDocRef.update(statsUpdate);

    logger.info(`Synced TikTok stats for ${request.auth.uid}: ${followers} followers, ${finalEngagementRate}% engagement.`);

    return {
      success: true,
      followers: followers,
      engagementRate: finalEngagementRate,
    };
  } catch (error: any) {
    const errorData = error.response?.data;
    const errorMsg = errorData?.error_description || errorData?.message || error.message;
    logger.error("TikTok sync failed:", errorMsg, {fullErrorData: errorData});
    throw new HttpsError("internal", `TikTok Sync Error: ${errorMsg}`);
  }
});
