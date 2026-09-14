"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

const MCP_SERVER_URL =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "verza-canvas"
    ? "https://api.tryverza.com"
    : "https://dev-api.tryverza.com";

const KEY_PLACEHOLDER = "vzmcp_YOUR_KEY_FROM_OPTIC";

function buildMcpConfigJson(apiKey: string) {
  return JSON.stringify(
    {
      mcpServers: {
        verza: {
          url: MCP_SERVER_URL,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      },
    },
    null,
    2
  );
}

type KeyRow = {
  id: string;
  label: string;
  keyPrefix: string;
  agencyId: string | null;
  revoked: boolean;
};

type Props = {
  /** Preview / marketing mode — no network. */
  preview?: boolean;
};

export function McpApiKeysCard({ preview = false }: Props) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(!preview);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("Claude / Cursor");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const configJson = useMemo(
    () => buildMcpConfigJson(freshKey ?? KEY_PLACEHOLDER),
    [freshKey]
  );

  const refresh = useCallback(async () => {
    if (preview) return;
    setLoading(true);
    try {
      const list = httpsCallable(functions, "listMcpApiKeys");
      const res = await list({});
      const data = res.data as { keys?: KeyRow[] };
      setKeys((data.keys ?? []).filter((k) => !k.revoked));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not load MCP keys", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [preview, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createKey = async () => {
    if (preview) return;
    setCreating(true);
    setFreshKey(null);
    try {
      const create = httpsCallable(functions, "createMcpApiKey");
      const res = await create({ label: label.trim() || "MCP key" });
      const data = res.data as { apiKey?: string };
      if (!data.apiKey) throw new Error("No apiKey returned");
      setFreshKey(data.apiKey);
      toast({
        title: "MCP API key created",
        description: "Copy the Cursor config below — the key won’t be shown again.",
      });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not create key", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (preview) return;
    try {
      const revoke = httpsCallable(functions, "revokeMcpApiKey");
      await revoke({ keyId });
      toast({ title: "Key revoked" });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Could not revoke", description: msg, variant: "destructive" });
    }
  };

  const copy = async (text: string, title = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">Verza MCP (Claude / ChatGPT / Cursor)</p>
          <p className="text-xs text-muted-foreground">
            Create a key, copy the config into Cursor Settings → MCP (or{" "}
            <code className="text-[11px]">~/.cursor/mcp.json</code>), then refresh MCP tools.
          </p>
        </div>
      </div>

      {freshKey && (
        <Alert>
          <AlertTitle>Copy your Cursor config</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Paste this into <code className="text-[11px]">~/.cursor/mcp.json</code>. Your API key
              is included — it won’t be shown again.
            </p>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {configJson}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void copy(configJson, "Cursor config copied")}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy config
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copy(freshKey, "API key copied")}
              >
                Copy key only
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!freshKey && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">Cursor / Claude config</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copy(configJson, "Config template copied")}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy config
            </Button>
          </div>
          <pre className="max-h-40 overflow-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
            {configJson}
          </pre>
          <p className="text-[11px] text-muted-foreground">
            Create a key below, then replace{" "}
            <code className="text-[10px]">{KEY_PLACEHOLDER}</code> — or create a key and we’ll fill
            it in for you.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="mcp-key-label" className="text-xs">
            Label
          </Label>
          <Input
            id="mcp-key-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={preview || creating}
            placeholder="Claude / Cursor"
          />
        </div>
        <Button
          type="button"
          onClick={() => void createKey()}
          disabled={preview || creating}
        >
          {creating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create API key"
          )}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading keys…</p>
      ) : keys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active MCP keys yet.</p>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{k.label}</p>
                <p className="font-mono text-muted-foreground">
                  {k.keyPrefix}
                  …
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => void revokeKey(k.id)}
                disabled={preview}
                aria-label="Revoke key"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
