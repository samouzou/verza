# Verza MCP Server

Expose **Optic creator discovery**, **campaign draft/launch from URL**, and **budget / predicted ROAS** tools to Claude, Cursor, ChatGPT, and other MCP clients.

## Tools

| Tool | Purpose |
|------|---------|
| `verza_whoami` | Agency user + Optic credits |
| `campaign_draft_from_url` | Scrape product URL → campaign draft (no charge) |
| `campaign_create` | Launch approved draft; returns **launchBrief** (ROAS report) |
| `campaign_launch_brief` | Full MacGyver report: budget + ROAS metrics + scout plan; persists to vault |
| `optic_list_campaigns` | Open/live Verza gigs |
| `optic_get_campaign` | Gig detail |
| `optic_start_discovery` | Verza Cloud Run worker mission (not Chrome extension) |
| `optic_prepare_agent_mission` | MCP agent scouts with own tools (IG/LinkedIn/X preferred) |
| `optic_submit_agent_lead` | Save one agent-found creator (1 credit) |
| `optic_complete_agent_mission` | Mark agent mission done |
| `optic_list_jobs` / `optic_get_job` / `optic_cancel_job` | Mission status |
| `optic_list_leads` / `optic_get_lead` | Vault creators + match scores |
| `campaign_estimate_budget` | rate × creators + fee illustration |
| `campaign_predict_roas` | Heuristic ROAS; also writes vault ROAS card |

**Chrome extension:** unchanged. In-app browser missions still use the Optic extension. MCP clients never hand off to it — for login-walled platforms they run `optic_prepare_agent_mission` and search themselves.

**Vault ROAS:** `gigs/{id}.opticRoasInsight` powers the Predicted ROAS card on `/optic/vault` when a campaign is selected.

## Auth model (agency = logged-in user)

| How you authenticate | Who the agency is |
|----------------------|-------------------|
| **MCP API key** (`vzmcp_…`) | User who created the key in Optic → Integrations |
| HTTP `Authorization: Bearer vzmcp_…` | Same (recommended for remote URL) |

## Deployed URL (recommended for Cursor)

| Env | MCP URL |
|-----|---------|
| Dev | `https://dev-api.tryverza.com` |
| Prod | `https://api.tryverza.com` |

These hostnames map to the Cloud Run `verza-mcp` service (root path). `/mcp` still works for older clients and the `*.run.app` URL.

### 1. Deploy to Cloud Run

```bash
cd apps/mcp-server
chmod +x scripts/deploy-cloud-run.sh
./scripts/deploy-cloud-run.sh verza-canvas-dev
# prod: ./scripts/deploy-cloud-run.sh verza-canvas
```

### 2. One-time custom domain (per env)

```bash
# Dev
gcloud beta run domain-mappings create \
  --service=verza-mcp \
  --domain=dev-api.tryverza.com \
  --region=us-central1 \
  --project=verza-canvas-dev

# Prod
gcloud beta run domain-mappings create \
  --service=verza-mcp \
  --domain=api.tryverza.com \
  --region=us-central1 \
  --project=verza-canvas
```

In your DNS for `tryverza.com`, add the CNAME (or A/AAAA) records Google prints for each host — typically a CNAME to `ghs.googlehosted.com`. Wait until the mapping shows certificate **Active**.

Grant the Cloud Run runtime service account Firestore + ability to mint Firebase custom tokens on that project (needed for `campaign_create`).

### 3. Point Cursor at the URL

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "verza": {
      "url": "https://dev-api.tryverza.com",
      "headers": {
        "Authorization": "Bearer vzmcp_YOUR_KEY_FROM_OPTIC"
      }
    }
  }
}
```

Prod: use `https://api.tryverza.com`. No local `node` process. Refresh MCP in Cursor Settings → MCP, then try `verza_whoami`.

## Local stdio (optional)

```bash
cd apps/mcp-server && npm install && npm run build
npm run start:dev
```

```json
{
  "mcpServers": {
    "verza": {
      "command": "node",
      "args": ["/absolute/path/to/verza/apps/mcp-server/dist/index.js"],
      "env": {
        "VERZA_ENV": "verza-canvas-dev",
        "VERZA_MCP_API_KEY": "vzmcp_…"
      }
    }
  }
}
```

## Suggested agent flows

### Launch from a product link
1. `campaign_draft_from_url`
2. Brand approves → `campaign_create` (`confirm=true`) — returns `launchBrief` report card
3. Present Predicted ROAS / spend / revenue metrics; fund via `checkoutUrl` if paid
4. Follow `launchBrief.nextActions` (agent scout → vault)
5. Re-run `campaign_launch_brief` after leads land to tighten ROAS

### Discover for an existing campaign
1. `optic_list_campaigns` → `optic_start_discovery` → `optic_list_leads`

### Agent scout (MCP does the search — no Chrome extension)
Use when Instagram / LinkedIn / X need a logged-in browser the agent already has:

1. `optic_prepare_agent_mission` — get `jobId`, brief, `excludeHandles`, `agentInstructions`
2. Search with your own tools; for each fit call `optic_submit_agent_lead`
3. `optic_complete_agent_mission` → `optic_list_leads`

