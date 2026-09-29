"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const runJob_1 = require("./runJob");
const port = Number.parseInt(process.env.PORT || "8080", 10);
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "64kb" }));
app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "linkedin-os-worker" });
});
app.post("/internal/run-job", async (req, res) => {
    const expected = process.env.LINKEDIN_OS_WORKER_SHARED_SECRET?.trim();
    const incoming = String(req.headers["x-verza-linkedin-os-secret"] ?? "");
    if (!expected || incoming !== expected) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const jobId = req.body?.jobId;
    if (typeof jobId !== "string" || !jobId.trim()) {
        res.status(400).json({ error: "jobId required" });
        return;
    }
    try {
        await (0, runJob_1.runLinkedInOsJob)(jobId.trim());
        res.status(200).json({ ok: true });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
});
app.listen(port, () => {
    console.log(`[linkedin-os-worker] listening on ${port}`);
});
