"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const MCP_API_URL =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "verza-canvas"
    ? "https://api.tryverza.com"
    : "https://dev-api.tryverza.com";

type RequestPreview = {
  request_id: string;
  client_name: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
};

export default function McpOauthConsentPage() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request_id")?.trim() ?? "";
  const { user, isLoading: authLoading, isAgencyTeam, getUserIdToken } = useAuth();
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setError("Missing sign-in request. Start again from your AI connector settings.");
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    void (async () => {
      try {
        const res = await fetch(
          `${MCP_API_URL}/oauth/request?request_id=${encodeURIComponent(requestId)}`
        );
        const data = (await res.json().catch(() => ({}))) as RequestPreview & {
          error_description?: string;
        };
        if (!res.ok) {
          throw new Error(
            data.error_description || "This sign-in link expired. Start again from your AI connector."
          );
        }
        if (!cancelled) setPreview(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load consent request.");
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const approve = useCallback(async () => {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Sign in to Verza first.");
      const res = await fetch(`${MCP_API_URL}/oauth/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ request_id: requestId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect_uri?: string;
        error_description?: string;
      };
      if (!res.ok || !data.redirect_uri) {
        throw new Error(data.error_description || "Could not approve access.");
      }
      window.location.href = data.redirect_uri;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
      setBusy(false);
    }
  }, [getUserIdToken, requestId]);

  const deny = useCallback(async () => {
    if (!requestId) return;
    setBusy(true);
    try {
      const res = await fetch(`${MCP_API_URL}/oauth/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirect_uri?: string };
      if (data.redirect_uri) {
        window.location.href = data.redirect_uri;
        return;
      }
    } catch {
      /* ignore */
    }
    setBusy(false);
    setError("Access denied.");
  }, [requestId]);

  if (authLoading || loadingPreview) {
    return (
      <div className="container max-w-lg space-y-6 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Preparing connector access…</p>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="container max-w-lg space-y-6 py-10">
        <PageHeader title="Connect AI assistant" description="Something went wrong." />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/optic">Back to Optic</Link>
        </Button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container max-w-lg space-y-6 py-10">
        <PageHeader
          title="Connect your AI assistant to Verza"
          description="Sign in to approve access for your brand workspace."
        />
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>
            Open Verza, sign in with the brand account that should use Optic, then return to this
            link (or start again from Claude / ChatGPT connector settings).
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href={`/login?next=${encodeURIComponent(`/optic/mcp/oauth/consent?request_id=${requestId}`)}`}>
            Sign in
          </Link>
        </Button>
      </div>
    );
  }

  if (!isAgencyTeam) {
    return (
      <div className="container max-w-lg space-y-6 py-10">
        <PageHeader title="Connect AI assistant" description="Brand team access required." />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Wrong account type</AlertTitle>
          <AlertDescription>
            Optic MCP is for brand owners, admins, and members. Switch to your brand workspace and
            try again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-lg space-y-6 py-10">
      <PageHeader
        title={`Allow ${preview?.client_name || "this app"} to use Verza Optic?`}
        description={`${preview?.client_name || "Your AI assistant"} wants access to your brand’s Optic tools.`}
      />

      <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div className="space-y-1 text-sm">
            <p>
              Signed in as <span className="font-medium">{user.email}</span>
            </p>
            <p className="text-muted-foreground">
              It will act as your brand workspace for creator discovery, vault leads, and outreach
              tools. You can disconnect anytime in the assistant’s connector settings.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not approve</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void approve()} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Allow access
        </Button>
        <Button type="button" variant="outline" onClick={() => void deny()} disabled={busy}>
          Deny
        </Button>
      </div>
    </div>
  );
}
