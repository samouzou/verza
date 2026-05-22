import "dotenv/config";
import express from "express";
import {runDiscoveryJob} from "./runJob";

const port = Number.parseInt(process.env.PORT || "8080", 10);

const app = express();
app.use(express.json({limit: "32kb"}));

app.get("/health", (_req, res) => {
  res.status(200).json({ok: true});
});

app.post("/internal/run-job", async (req, res) => {
  const expected = process.env.OPTIC_WORKER_SHARED_SECRET?.trim();
  const incoming = String(req.headers["x-verza-optic-secret"] ?? "");
  if (!expected || incoming !== expected) {
    res.status(401).json({error: "unauthorized"});
    return;
  }
  const jobId = req.body?.jobId;
  if (typeof jobId !== "string" || !jobId.trim()) {
    res.status(400).json({error: "jobId required"});
    return;
  }

  try {
    await runDiscoveryJob(jobId.trim());
    res.status(200).json({ok: true});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({error: msg});
  }
});

app.listen(port, () => {
  console.log(`[optic-worker] listening on ${port}`);
});
