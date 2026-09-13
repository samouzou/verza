"use client";

import { useCallback, useEffect, useState } from "react";
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
        description: "Copy it now — it won’t be shown again.",
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied" });
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
            Connect Claude, ChatGPT, or Cursor to your brand workspace. Server URL:{" "}
            <code className="text-[11px]">{MCP_SERVER_URL}</code>
            {" · "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void copy(MCP_SERVER_URL)}
            >
              Copy
            </button>
            . Create a personal API key below and use it as the Bearer token in your MCP client.
          </p>
        </div>
      </div>

      {freshKey && (
        <Alert>
          <AlertTitle>Copy your new key</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="break-all font-mono text-xs">{freshKey}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void copy(freshKey)}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy
            </Button>
          </AlertDescription>
        </Alert>
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
