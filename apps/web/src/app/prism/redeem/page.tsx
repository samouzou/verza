"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2, Ticket } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { PRISM_TIERS } from "@/hooks/use-prism-plan";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import {
  clearAppSumoPrismCode,
  normalizeAppSumoPrismCode,
  readAppSumoPrismCode,
  rememberAppSumoPrismCode,
} from "@/lib/prism/appsumo-code";

const INCLUDED = [
  "Content calendar, composer and team approvals on every channel",
  "Brand setup, product catalog and voice profile",
  `${PRISM_TIERS.lifetime.ai} AI actions a month, Studio included`,
  "Unlimited branded carousels (PDF and PNG)",
  `${PRISM_TIERS.lifetime.graphics} Instagram feed graphics a month`,
  "AI Reels and TikToks with video credit packs",
];

function callableMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: string }).message === "string") {
    return (err as { message: string }).message.replace(/^Firebase:\s*/, "").replace(/\s*\([^)]+\)\s*$/, "");
  }
  return "Try again in a moment.";
}

export default function PrismRedeemPage() {
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    isProcessing,
    loginWithGoogle,
    loginWithEmailAndPassword,
    signupWithEmailAndPassword,
    refreshAuthUser,
  } = useAuth();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    const stored = readAppSumoPrismCode();
    if (stored) setCode(stored);
  }, []);

  const redeem = useCallback(
    async (raw: string) => {
      const trimmed = normalizeAppSumoPrismCode(raw);
      if (trimmed.length < 6) {
        toast({ title: "Enter your AppSumo code", variant: "destructive" });
        return false;
      }
      rememberAppSumoPrismCode(trimmed);
      setBusy(true);
      try {
        await httpsCallable(functions, "redeemAppSumoPrismCode")({ code: trimmed });
        await refreshAuthUser();
        clearAppSumoPrismCode();
        setDone(true);
        setCode("");
        toast({ title: "Prism Lifetime unlocked", description: "Your brand is set for life." });
        return true;
      } catch (err: unknown) {
        toast({
          title: "Couldn't redeem that code",
          description: callableMessage(err),
          variant: "destructive",
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refreshAuthUser, toast]
  );

  useEffect(() => {
    if (autoTried.current || authLoading || !isAuthenticated || done || busy) return;
    const pending = readAppSumoPrismCode();
    if (!pending || pending.length < 6) return;
    autoTried.current = true;
    void redeem(pending);
  }, [authLoading, isAuthenticated, done, busy, redeem]);

  const onCodeChange = (value: string) => {
    setCode(value);
    if (value.trim().length >= 6) rememberAppSumoPrismCode(value);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = normalizeAppSumoPrismCode(code);
    if (trimmed.length < 6) {
      toast({ title: "Enter your AppSumo code", variant: "destructive" });
      return;
    }
    rememberAppSumoPrismCode(trimmed);

    if (isAuthenticated) {
      autoTried.current = true;
      await redeem(trimmed);
      return;
    }

    if (!email.trim() || password.length < 6) {
      toast({
        title: mode === "signup" ? "Add email and a password" : "Enter your email and password",
        variant: "destructive",
      });
      return;
    }

    setBusy(true);
    const authError =
      mode === "signup"
        ? await signupWithEmailAndPassword(email.trim(), password)
        : await loginWithEmailAndPassword(email.trim(), password);
    setBusy(false);
    if (authError) {
      toast({ title: mode === "signup" ? "Couldn't create account" : "Couldn't sign in", description: authError, variant: "destructive" });
      return;
    }
    autoTried.current = false;
  };

  const onGoogle = async () => {
    const trimmed = normalizeAppSumoPrismCode(code);
    if (trimmed.length >= 6) rememberAppSumoPrismCode(trimmed);
    autoTried.current = false;
    await loginWithGoogle();
  };

  const submitting = busy || isProcessing;

  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <Link href="https://www.tryverza.com" className="flex items-center gap-2 font-semibold">
            <Image src="/verza-icon.svg" alt="Verza" width={28} height={28} />
            <span>Prism</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              AppSumo
            </span>
          </Link>
          {isAuthenticated ? (
            <Link href="/prism" className="text-sm text-muted-foreground hover:text-foreground">
              Open Prism
            </Link>
          ) : (
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
              {mode === "signup" ? "I already have an account" : "Create an account"}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Redeem your AppSumo code</h1>
          <p className="text-muted-foreground">
            Paste the code from your AppSumo library. We&apos;ll attach Prism Lifetime to this email so you can start
            planning and publishing right away.
          </p>
        </div>

        {done && (
          <Alert className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Prism Lifetime is on</AlertTitle>
            <AlertDescription>
              <Link href="/prism/setup" className="font-medium text-primary underline-offset-4 hover:underline">
                Set up your brand
              </Link>{" "}
              so Prism writes in your voice, then open the{" "}
              <Link href="/prism" className="font-medium text-primary underline-offset-4 hover:underline">
                calendar
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        {!done && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Ticket className="h-5 w-5 text-emerald-600" />
                {isAuthenticated ? "Enter your code" : mode === "signup" ? "Code, email, and a password" : "Code and sign in"}
              </CardTitle>
              <CardDescription>
                {isAuthenticated
                  ? `Redeeming for ${user?.email || "your account"}.`
                  : "AppSumo reviewers and buyers can finish this on one screen — no extra login hop."}
              </CardDescription>
            </CardHeader>
            <form onSubmit={(e) => void onSubmit(e)}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="appsumo-code">AppSumo code</Label>
                  <Input
                    id="appsumo-code"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="AS-PRSM-XXXXX-XXXXX"
                    value={code}
                    onChange={(e) => onCodeChange(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                {!isAuthenticated && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="appsumo-email">Email</Label>
                      <Input
                        id="appsumo-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={submitting}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="appsumo-password">Password</Label>
                      <Input
                        id="appsumo-password"
                        type="password"
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={submitting}
                        minLength={6}
                        required
                      />
                    </div>
                  </>
                )}
              </CardContent>
              <CardFooter className="flex flex-col items-stretch gap-3 sm:items-start">
                <Button type="submit" className="w-full sm:w-auto" disabled={submitting || !code.trim()}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isAuthenticated ? "Redeem" : mode === "signup" ? "Create account and redeem" : "Sign in and redeem"}
                </Button>
                {!isAuthenticated && (
                  <>
                    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => void onGoogle()} disabled={submitting}>
                      Continue with Google
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {mode === "signup" ? (
                        <>
                          Already on Verza?{" "}
                          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signin")}>
                            Sign in
                          </button>
                        </>
                      ) : (
                        <>
                          New here?{" "}
                          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signup")}>
                            Create an account
                          </button>
                        </>
                      )}
                    </p>
                  </>
                )}
              </CardFooter>
            </form>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What Prism Lifetime includes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Lifetime matches our $29/month Starter plan, paid once. Auto-publishing to connected accounts starts on
              Prism Launch: on Lifetime you copy each approved post and mark it posted, or upgrade any time.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
