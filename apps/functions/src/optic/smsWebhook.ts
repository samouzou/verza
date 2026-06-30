import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {
  enqueueOpticContinuationJob,
  findUidByOpticSmsPhone,
  loadLatestContinuableJob,
  parseSmsCommand,
} from "./continuation";
import {normalizeSmsPhone, validateTwilioWebhook} from "./twilio";
import {TWILIO_AUTH_TOKEN} from "../config/params";

/**
 * Builds a TwiML XML response with a single reply message.
 * @param {string} message Plain-text body for the SMS reply.
 * @return {string} TwiML XML document.
 */
function twiml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

/** Inbound Twilio SMS — HELP (any number), STOP / CONTINUE for enrolled numbers. */
export const opticTwilioSmsWebhook = onRequest(
  {secrets: [TWILIO_AUTH_TOKEN], cors: false},
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (typeof v === "string") params[k] = v;
    }

    const signature = req.get("x-twilio-signature");
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    if (!validateTwilioWebhook(signature, url, params)) {
      logger.warn("[Optic SMS] Invalid Twilio signature");
      res.status(403).send("Forbidden");
      return;
    }

    const fromRaw = params.From ?? "";
    const body = params.Body ?? "";
    const from = normalizeSmsPhone(fromRaw);
    if (!from) {
      res.type("text/xml").send(twiml("We could not read your phone number."));
      return;
    }

    const cmd = parseSmsCommand(body);

    if (cmd === "help") {
      res
        .type("text/xml")
        .send(
          twiml(
            "Verza Optic: transactional SMS from Verza Technologies, Inc. about batch status. " +
              "Msg/data rates may apply. Reply STOP to opt out. support@tryverza.com tryverza.com"
          )
        );
      return;
    }

    const uid = await findUidByOpticSmsPhone(from);

    if (!uid) {
      res.type("text/xml").send(twiml("Link this number in Verza Optic under Text updates first."));
      return;
    }

    if (cmd === "stop") {
      await db.collection("users").doc(uid).update({
        opticSmsEnabled: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      res.type("text/xml").send(twiml("You will not receive Optic texts. Re-enable anytime in the app."));
      return;
    }

    if (cmd === "continue") {
      try {
        const recent = await db
          .collection("optic_jobs")
          .where("uid", "==", uid)
          .orderBy("createdAt", "desc")
          .limit(5)
          .get();
        const busy = recent.docs.some((d) => {
          const s = String(d.data().status ?? "");
          return s === "queued" || s === "running";
        });
        if (busy) {
          res.type("text/xml").send(twiml("A batch is already running. We will text you when it is done."));
          return;
        }

        const source = await loadLatestContinuableJob(uid);
        const jobId = await enqueueOpticContinuationJob(source, {
          smsNotify: true,
          fromJobId: source.id,
        });
        logger.info("[Optic SMS] CONTINUE enqueued", {uid, jobId});
        res
          .type("text/xml")
          .send(twiml("Starting your next batch. We will text you when creators are in your vault."));
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not start a batch.";
        res.type("text/xml").send(twiml(msg.slice(0, 140)));
        return;
      }
    }

    res
      .type("text/xml")
      .send(
        twiml(
          "Reply CONTINUE for another batch, STOP to opt out, or HELP for program information."
        )
      );
  }
);
