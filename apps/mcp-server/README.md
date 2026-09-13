# Verza MCP Server

Expose **Optic creator discovery**, **campaign draft/launch from URL**, and **budget / predicted ROAS** tools to Claude, Cursor, ChatGPT, and other MCP clients.

## Tools

| Tool | Purpose |
|------|---------|
| `verza_whoami` | Agency user + Optic credits |
| `campaign_draft_from_url` | Scrape product URL → campaign draft (no charge) |
| `campaign_create` | Launch approved draft (`confirm=true`); Stripe URL or live |
| `optic_list_campaigns` | Open/live Verza gigs |
| `optic_get_campaign` | Gig detail |
| `optic_start_discovery` | Start Optic mission (uses credits) |
| `optic_list_jobs` / `optic_get_job` / `optic_cancel_job` | Mission status |
| `optic_list_leads` / `optic_get_lead` | Vault creators + match scores |
| `campaign_estimate_budget` | rate × creators + fee illustration |
| `campaign_predict_roas` | Heuristic ROAS from vault reach + AOV/CVR |

## Auth model (agency = logged-in user)

| How you authenticate | Who the agency is |
|----------------------|-------------------|
| **MCP API key** (`vzmcp_…`) | User who created the key in Optic → Integrations |
| HTTP `Authorization: Bearer vzmcp_…` | Same (recommended for remote URL) |

## Deployed URL (recommended for Cursor)

### 1. Deploy to Cloud Run

```bash
cd apps/mcp-server
chmod +x scripts/deploy-cloud-run.sh
./scripts/deploy-cloud-run.sh verza-canvas-dev
# prod: ./scripts/deploy-cloud-run.sh verza-canvas
```

The script prints your MCP URL, e.g. `https://verza-mcp-xxxxx-uc.a.run.app/mcp`.

Grant the Cloud Run runtime service account Firestore + ability to mint Firebase custom tokens on that project (needed for `campaign_create`).

### 2. Point Cursor at the URL

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "verza": {
      "url": "https://verza-mcp-xxxxx-uc.a.run.app/mcp",
      "headers": {
        "Authorization": "Bearer vzmcp_YOUR_KEY_FROM_OPTIC"
      }
    }
  }
}
```

No local `node` process. Refresh MCP in Cursor Settings → MCP, then try `verza_whoami`.

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
2. Brand approves → `campaign_create` (`confirm=true`)
3. Fund via `checkoutUrl` if paid
4. `optic_start_discovery` → `campaign_predict_roas`

### Discover for an existing campaign
1. `optic_list_campaigns` → `optic_start_discovery` → `optic_list_leads`
