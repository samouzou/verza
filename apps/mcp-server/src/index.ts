#!/usr/bin/env node
import {loadProjectEnv} from "./loadEnv.js";
loadProjectEnv();

import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  identityFromBearer,
  resolveActingActor,
  runWithAuthIdentity,
} from "./auth.js";
import {assertFirebaseCredentialsHint, loadConfig, type VerzaMcpConfig} from "./config.js";
import type {Firestore} from "firebase-admin/firestore";
import {getDb} from "./firebase.js";
import {createVerzaMcpServer} from "./server.js";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function extractBearer(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.trim()) return auth.trim();
  const alt = req.headers["x-verza-mcp-key"];
  if (typeof alt === "string" && alt.trim()) return `Bearer ${alt.trim()}`;
  if (Array.isArray(alt) && alt[0]) return `Bearer ${alt[0].trim()}`;
  return null;
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, Mcp-Session-Id, X-Verza-Mcp-Key, X-Verza-Mcp-Gate"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

async function handleMcpHttpRequest(opts: {
  req: IncomingMessage;
  res: ServerResponse;
  db: Firestore;
  config: VerzaMcpConfig;
}): Promise<void> {
  const {req, res, db, config} = opts;
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = pathnameOf(req);
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        ok: true,
        name: "verza-mcp",
        transport: "streamable-http",
      })
    );
    return;
  }

  // Root is the public endpoint (api.tryverza.com). /mcp kept for older clients / run.app URLs.
  const isMcpPath = path === "/" || path === "/mcp" || path.startsWith("/mcp/");
  if (!isMcpPath) {
    res.writeHead(404, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        error: "not_found",
        hint: "MCP endpoint is the server root (or /mcp).",
      })
    );
    return;
  }

  if (config.httpToken) {
    const gate = req.headers["x-verza-mcp-gate"];
    const gateVal = Array.isArray(gate) ? gate[0] : gate;
    if (gateVal !== config.httpToken) {
      res.writeHead(401, {"content-type": "application/json"});
      res.end(JSON.stringify({error: "unauthorized_gate"}));
      return;
    }
  }

  let identity = null;
  try {
    identity = await identityFromBearer(db, extractBearer(req));
  } catch (err) {
    res.writeHead(401, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "unauthorized",
      })
    );
    return;
  }

  if (!identity) {
    res.writeHead(401, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        error:
          "Missing Authorization: Bearer <vzmcp_… API key>. Create one in Optic → Integrations.",
      })
    );
    return;
  }

  await runWithAuthIdentity(identity, async () => {
    const getActor = async () =>
      resolveActingActor({
        db,
        envUid: null,
        envEmail: null,
        envApiKey: null,
      });

    // Per-request server+transport keeps multi-tenant Cloud Run isolation clean.
    const server = createVerzaMcpServer({db, getActor, config});
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    try {
      const parsedBody =
        req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
          ? await readJsonBody(req)
          : undefined;
      await transport.handleRequest(req, res, parsedBody);
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });
}

async function main() {
  const config = loadConfig();
  assertFirebaseCredentialsHint();
  const db = getDb(config.projectId);

  if (config.transport === "http") {
    const host = process.env.PORT ? "0.0.0.0" : config.httpHost;
    const port = process.env.PORT
      ? Number.parseInt(process.env.PORT, 10)
      : config.httpPort;

    const httpServer = createServer((req, res) => {
      void handleMcpHttpRequest({req, res, db, config}).catch((err) => {
        console.error("[verza-mcp] HTTP error", err);
        if (!res.headersSent) {
          res.writeHead(500, {"content-type": "application/json"});
          res.end(JSON.stringify({error: "internal"}));
        }
      });
    });

    httpServer.listen(port, host, () => {
      console.error(
        `[verza-mcp] HTTP listening on http://${host}:${port}/ (Bearer vzmcp_… per user; /mcp also works)`
      );
    });
    return;
  }

  const getActor = async () =>
    resolveActingActor({
      db,
      envUid: config.uid,
      envEmail: config.userEmail,
      envApiKey: config.mcpApiKey,
    });

  const actor = await getActor();
  console.error(
    `[verza-mcp] Default identity ${actor.email ?? actor.uid} · agency ${actor.agencyName} (${actor.agencyId})`
  );

  const server = createVerzaMcpServer({db, getActor, config});
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[verza-mcp] stdio transport ready");
}

main().catch((err) => {
  console.error("[verza-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
