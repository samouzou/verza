import "dotenv/config";
import express from "express";
import {renderPostSlides, RenderInputError} from "./renderPost";
import {runLinkedInOsJob} from "./runJob";

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

app.listen(port, () => {
  console.log(`[linkedin-os-worker] listening on ${port}`);
});
