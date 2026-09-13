#!/usr/bin/env bash
# Deploy Verza MCP (Streamable HTTP) to Cloud Run.
# Usage:
#   ./scripts/deploy-cloud-run.sh verza-canvas-dev
#   ./scripts/deploy-cloud-run.sh verza-canvas
set -euo pipefail

PROJECT_ID="${1:-verza-canvas-dev}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-verza-mcp}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$PROJECT_ID" == "verza-canvas" ]]; then
  APP_URL="https://app.tryverza.com"
  WEB_API_KEY_DEFAULT=""
else
  APP_URL="https://dev-app.tryverza.com"
  WEB_API_KEY_DEFAULT=""
fi

# Prefer keys already in the local project env file (gitignored).
ENV_FILE="$ROOT/.env.$PROJECT_ID"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # Only export known safe keys from the file
  WEB_API_KEY="$(grep -E '^VERZA_FIREBASE_WEB_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
  GEMINI_KEY="$(grep -E '^GEMINI_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
  set +a
fi

WEB_API_KEY="${VERZA_FIREBASE_WEB_API_KEY:-${WEB_API_KEY:-$WEB_API_KEY_DEFAULT}}"
GEMINI_KEY="${GEMINI_API_KEY:-${GEMINI_KEY:-}}"

if [[ -z "$WEB_API_KEY" ]]; then
  echo "Missing VERZA_FIREBASE_WEB_API_KEY (set env or put it in .env.$PROJECT_ID)" >&2
  exit 1
fi
if [[ -z "$GEMINI_KEY" ]]; then
  echo "Missing GEMINI_API_KEY (set env or put it in .env.$PROJECT_ID)" >&2
  exit 1
fi

echo "Deploying $SERVICE to $PROJECT_ID ($REGION)…"

gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source="$ROOT" \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --min-instances=0 \
  --max-instances=10 \
  --allow-unauthenticated \
  --set-env-vars="VERZA_MCP_TRANSPORT=http,VERZA_FIREBASE_PROJECT_ID=${PROJECT_ID},VERZA_APP_URL=${APP_URL},VERZA_FUNCTIONS_REGION=us-central1,VERZA_FIREBASE_WEB_API_KEY=${WEB_API_KEY},GEMINI_API_KEY=${GEMINI_KEY}"

URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"

echo
echo "Deployed: ${URL}"
echo "MCP endpoint: ${URL}/mcp"
echo
echo "Cursor ~/.cursor/mcp.json:"
echo
cat <<EOF
{
  "mcpServers": {
    "verza": {
      "url": "${URL}/mcp",
      "headers": {
        "Authorization": "Bearer vzmcp_YOUR_KEY_FROM_OPTIC"
      }
    }
  }
}
EOF
echo
echo "Cloud Run service account needs Firestore + Auth token minting on ${PROJECT_ID}."
