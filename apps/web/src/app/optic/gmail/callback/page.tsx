"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { functions } from "@/lib/firebase";

export default function OpticGmailCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const exchanged = useRef(false);

  useEffect(() => {
    if (authLoading || exchanged.current) return;

    const oauthError = searchParams.get("error");
    if (oauthError) {
      setError(oauthError === "access_denied" ? "You declined Gmail access." : oauthError);
      return;
    }

    const code = searchParams.get("code");
    if (!code) {
      setError("Missing authorization code from Google.");
      return;
    }

    if (!user) {
      setError("Sign in to Verza, then run Connect Gmail again.");
      return;
    }

    exchanged.current = true;
    void (async () => {
      try {
        const complete = httpsCallable(functions, "completeGmailConnect");
        await complete({ code });
        setDone(true);
        router.replace("/optic");
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not finish Gmail connection.";
        setError(message);
      }
    })();
  }, [authLoading, router, searchParams, user]);

  if (authLoading || (!done && !error)) {
    return (
      <div className="container max-w-lg space-y-6 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Finishing Gmail connection…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container max-w-lg space-y-6 py-10">
        <PageHeader title="Gmail connection" description="Something went wrong." />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/optic">Back to Optic</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-lg space-y-6 py-10 text-center">
      <PageHeader
        title="Gmail connected"
        description="Drafts from the vault can now be saved to your Gmail account."
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link href="/optic/vault">Open vault</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/optic">Discovery</Link>
        </Button>
      </div>
    </div>
  );
}
