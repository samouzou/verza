import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "./config/firebase";
import * as admin from "firebase-admin";

export const conversionWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const agencyId = req.query.agencyId as string;
  if (!agencyId) {
    res.status(400).send("Missing agencyId query parameter");
    return;
  }

  try {
    const agencyRef = db.collection("agencies").doc(agencyId);
    const agencySnap = await agencyRef.get();
    if (!agencySnap.exists) {
      res.status(404).send("Agency not found");
      return;
    }
    const agencyData = agencySnap.data();

    // Validation (e.g. HMAC signature) could be checked here using agencyData.webhookSecret

    const payload = req.body;
    let matchingPromoCode = "";
    let matchingClickId = "";

    // Shopify discount codes check
    if (payload.discount_codes && Array.isArray(payload.discount_codes)) {
      for (const codeObj of payload.discount_codes) {
        if (codeObj.code) {
          matchingPromoCode = codeObj.code.toUpperCase();
          break;
        }
      }
    }

    if (payload.note_attributes) {
      const clickIdAttr = payload.note_attributes.find((attr: any) => attr.name === "verza_click_id");
      if (clickIdAttr) {
        matchingClickId = clickIdAttr.value;
      }
    }

    if (!matchingPromoCode && !matchingClickId) {
      res.status(200).send({message: "No relevant tracking parameters found"});
      return;
    }

    let affiliateLinkSnap;
    if (matchingPromoCode) {
      const qs = await db.collection("affiliateLinks")
        .where("brandId", "==", agencyId)
        .where("promoCode", "==", matchingPromoCode)
        .limit(1)
        .get();
      if (!qs.empty) affiliateLinkSnap = qs.docs[0];
    }

    if (!affiliateLinkSnap) {
      res.status(200).send({message: "No matching affiliate link found"});
      return;
    }

    const affiliateLinkRef = affiliateLinkSnap.ref;
    const linkData = affiliateLinkSnap.data();
    const gigId = linkData.gigId;
    const creatorId = linkData.creatorId;

    const gigSnap = await db.collection("gigs").doc(gigId).get();
    if (!gigSnap.exists) {
      res.status(404).send("Gig not found");
      return;
    }
    const gigData = gigSnap.data();
    const rewardAmount = gigData?.affiliateSettings?.rewardAmount || 0;

    let budgetExhausted = false;

    await db.runTransaction(async (transaction) => {
      transaction.update(affiliateLinkRef, {
        conversions: admin.firestore.FieldValue.increment(1),
      });

      if (rewardAmount > 0) {
        const currentAgencySnap = await transaction.get(agencyRef);
        const currentAgencyData = currentAgencySnap.data();

        if (currentAgencyData && (currentAgencyData.availableBalance || 0) >= rewardAmount) {
          transaction.update(affiliateLinkRef, {
            earnedRewards: admin.firestore.FieldValue.increment(rewardAmount),
          });

          transaction.update(agencyRef, {
            availableBalance: admin.firestore.FieldValue.increment(-rewardAmount),
          });
        } else {
          budgetExhausted = true;
          // Halt payments and mark the gig as budget exhausted
          transaction.update(gigSnap.ref, {status: "budget_exhausted"});
        }
      }
    });

    if (budgetExhausted) {
      await db.collection("notifications").add({
        userId: agencyData?.ownerId,
        title: "Campaign Paused: Insufficient Funds",
        message: `Your campaign "${gigData?.title}" tracking links have been paused due to insufficient wallet funds.`,
        type: "system",
        read: false,
        link: "/wallet",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.warn(`Agency ${agencyId} exhausted budget on gig ${gigId} during conversion.`);
      // We still processed the conversion count, but no reward was paid out
    } else if (rewardAmount > 0) {
      await db.collection("notifications").add({
        userId: creatorId,
        title: "Performance Bonus Earned!",
        message: `Your code ${matchingPromoCode} generated a sale! You earned $${rewardAmount}.`,
        type: "system",
        read: false,
        link: `/campaigns/${gigId}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    logger.info(`Processed conversion for agency ${agencyId}, code ${matchingPromoCode}`);
    res.status(200).send({message: "Conversion processed successfully"});
  } catch (error: any) {
    logger.error("Error processing conversion webhook:", error);
    res.status(500).send({error: "Internal Server Error"});
  }
});
