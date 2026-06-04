import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {APP_URL, TWILIO_AUTH_TOKEN} from "../config/params";
import {OPTIC_DEFAULT_BATCH_SIZE} from "./constants";
import {sendOpticSms} from "./twilio";

/** Texts the user when a batch completes and they opted in to SMS. */
export const opticJobSmsOnComplete = onDocumentUpdated(
  {
    document: "optic_jobs/{jobId}",
    secrets: [TWILIO_AUTH_TOKEN],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === after.status) return;
    if (after.status !== "completed") return;
    if (!after.smsNotify) return;
    if (after.smsCompletionSent) return;

    const uid = String(after.uid ?? "");
    if (!uid) return;

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) return;
    const user = userSnap.data()!;
    if (!user.opticSmsEnabled) return;
    const phone = typeof user.opticSmsPhone === "string" ? user.opticSmsPhone : "";
    if (!phone.trim()) return;

    const saved = typeof after.processedCount === "number" ? after.processedCount : 0;
    const batchSize =
      typeof after.maxProfiles === "number" ? after.maxProfiles : OPTIC_DEFAULT_BATCH_SIZE;
    const vaultUrl = `${APP_URL.value().replace(/\/$/, "")}/optic/vault`;
    const batchNum = typeof after.batchIndex === "number" ? after.batchIndex : 1;

    const body =
      `Batch ${batchNum} complete: ${saved} creator${saved === 1 ? "" : "s"} saved. ` +
      `Reply CONTINUE for ~${batchSize} more, STOP to opt out, HELP for help. ${vaultUrl}`;

    const sent = await sendOpticSms(phone, body);
    if (sent) {
      await event.data?.after.ref.update({smsCompletionSent: true});
      logger.info("[Optic SMS] Batch completion text sent", {jobId: event.params.jobId, uid});
    }
  }
);
