import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {db} from "./config/firebase";
import * as admin from "firebase-admin";

export const onAffiliateLinkClick = onDocumentUpdated("affiliateLinks/{linkId}", async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();

  if (!beforeData || !afterData) return;

  // Only proceed if clicks incremented
  const beforeClicks = beforeData.clicks || 0;
  const afterClicks = afterData.clicks || 0;
  const newClicks = afterClicks - beforeClicks;

  if (newClicks <= 0) return;

  const linkRef = event.data?.after.ref;
  const gigId = afterData.gigId;
  const creatorId = afterData.creatorId;
  const brandId = afterData.brandId;

  if (!linkRef || !gigId) return;

  try {
    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) return;

    const gigData = gigSnap.data();
    const affiliateSettings = gigData?.affiliateSettings;

    // Only process for CPC campaigns
    if (!affiliateSettings || affiliateSettings.rewardType !== "cpc" || !affiliateSettings.rewardAmount) return;

    const rewardAmount = affiliateSettings.rewardAmount * newClicks;

    let budgetExhausted = false;

    if (rewardAmount > 0) {
      await db.runTransaction(async (transaction) => {
        const agencyRef = db.collection("agencies").doc(brandId);
        const agencySnap = await transaction.get(agencyRef);

        if (agencySnap.exists) {
          const agencyData = agencySnap.data();
          if (agencyData && (agencyData.availableBalance || 0) >= rewardAmount) {
            transaction.update(linkRef, {
              earnedRewards: admin.firestore.FieldValue.increment(rewardAmount),
            });
            transaction.update(agencyRef, {
              availableBalance: admin.firestore.FieldValue.increment(-rewardAmount),
            });
          } else {
            budgetExhausted = true;
            transaction.update(gigSnap.ref, {status: "budget_exhausted"});
          }
        }
      });

      if (budgetExhausted) {
        const agencyRef = db.collection("agencies").doc(brandId);
        const agencySnap = await agencyRef.get();
        await db.collection("notifications").add({
          userId: agencySnap.data()?.ownerId,
          title: "Campaign Paused: Insufficient Funds",
          message: `Your campaign "${gigData?.title}" tracking links have been paused due to insufficient wallet funds.`,
          type: "system",
          read: false,
          link: "/wallet",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.warn(`Agency ${brandId} exhausted budget on gig ${gigId} during click tracking.`);
      } else {
        logger.info(`Processed ${newClicks} clicks (CPC) for creator ${creatorId} on gig ${gigId}. Earned: $${rewardAmount}`);
      }
    }
  } catch (error) {
    logger.error(`Error processing CPC click for link ${event.params.linkId}: ${error}`);
  }
});
