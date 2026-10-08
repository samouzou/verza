import "dotenv/config";
import express from "express";
import {renderPostSlides, RenderInputError} from "./renderPost";
import {renderFeedGraphic} from "./renderFeed";
import {runLinkedInOsJob} from "./runJob";
import {renderPrismVideo} from "./video/renderVideo";

const port = Number.parseInt(process.env.PORT || "8080", 10);

const app = express();
app.use(express.json({limit: "64kb"}));

app.get("/health", (_req, res) => {
  res.status(200).json({ok: true, service: "linkedin-os-worker"});
});

app.use("/internal", (req, res, next) => {
  const expected = process.env.LINKEDIN_OS_WORKER_SHARED_SECRET?.trim();
  const incoming = String(req.headers["x-verza-linkedin-os-secret"] ?? "");
  if (!expected || incoming !== expected) {
    res.status(401).json({error: "unauthorized"});
    return;
  }
  next();
});

app.post("/internal/run-job", async (req, res) => {
  const jobId = req.body?.jobId;
  if (typeof jobId !== "string" || !jobId.trim()) {
    res.status(400).json({error: "jobId required"});
    return;
  }

  try {
    await runLinkedInOsJob(jobId.trim());
    res.status(200).json({ok: true});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({error: msg});
  }
});

app.post("/internal/render-slides", async (req, res) => {
  const postId = req.body?.postId;
  const channel = req.body?.channel;
  if (typeof postId !== "string" || !postId.trim() || typeof channel !== "string" || !channel.trim()) {
    res.status(400).json({error: "postId and channel required"});
    return;
  }
  try {
    const result = await renderPostSlides(postId.trim(), channel.trim());
    res.status(200).json({ok: true, ...result});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(e instanceof RenderInputError ? 400 : 500).json({error: msg});
  }
});

app.post("/internal/render-feed", async (req, res) => {
  const {agencyId, productId, headline, sub} = req.body ?? {};
  if (typeof agencyId !== "string" || !agencyId.trim() || typeof productId !== "string" || !productId.trim()) {
    res.status(400).json({error: "agencyId and productId required"});
    return;
  }
  try {
    const png = await renderFeedGraphic({
      agencyId: agencyId.trim(),
      productId: productId.trim(),
      headline: typeof headline === "string" ? headline.trim().slice(0, 120) : "",
      sub: typeof sub === "string" ? sub.trim().slice(0, 160) : "",
    });
    res.status(200).json({ok: true, png: png.toString("base64")});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(e instanceof RenderInputError ? 400 : 500).json({error: msg});
  }
});

app.post("/internal/render-video", async (req, res) => {
  const jobId = req.body?.jobId;
  if (typeof jobId !== "string" || !jobId.trim()) {
    res.status(400).json({error: "jobId required"});
    return;
  }
  try {
    await renderPrismVideo(jobId.trim());
    res.status(200).json({ok: true});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({error: msg});
  }
});

app.listen(port, () => {
  console.log(`[linkedin-os-worker] listening on ${port}`);
});
