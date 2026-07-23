"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  CheckCircle,
  ExternalLink,
  Globe,
  Loader2,
  Smartphone,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import {
  INFLOW_COUNTRY_OPTIONS,
  getInflowCountryDisplayName,
  isInflowPayoutCountry,
  iso2ForInflowCountryInput,
  toInflowCountryCode,
} from "@/lib/inflow-corridors";
import { isPayoutReady } from "@/lib/payout";

type BankField = {
  name?: string;
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

function extractBankFields(form: Record<string, unknown>): BankField[] {
  const raw = form.fields ?? form.inputs ?? form.sections;
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (item && typeof item === "object" && Array.isArray((item as { fields?: unknown }).fields)) {
        return (item as { fields: BankField[] }).fields;
      }
      return [item as BankField];
    });
  }
  return [];
}

type InflowPayoutCardProps = {
  initialCountry?: string;
};

export function InflowPayoutCard({ initialCountry = "NG" }: InflowPayoutCardProps) {
  const { user, refreshAuthUser } = useAuth();
  const { toast } = useToast();
  const [country, setCountry] = useState(() =>
    iso2ForInflowCountryInput(user?.inflowPayoutCountry || initialCountry)
  );
  const [busy, setBusy] = useState(false);
  const [bankForm, setBankForm] = useState<Record<string, unknown> | null>(null);
  const [bankFields, setBankFields] = useState<BankField[]>([]);
  const [bankValues, setBankValues] = useState<Record<string, string>>({});
  const [loadingBankForm, setLoadingBankForm] = useState(false);

  const ready = isPayoutReady(user);
  const kycReady = !!user?.inflowKycReady;
  const hasSubMerchant = !!user?.inflowSubMerchantId;
  const hasPayoutAccount = !!user?.inflowPayoutAccountId;

  const syncKyc = useCallback(async () => {
    const callable = httpsCallable(functions, "syncInflowKycStatus");
    const res = await callable();
    await refreshAuthUser();
    return res.data as {
      kycReady?: boolean;
      nextUrl?: string | null;
      kycStatus?: string;
    };
  }, [refreshAuthUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("inflow_kyc_return") !== "true" || !user?.inflowSubMerchantId) {
      return;
    }
    syncKyc()
      .then((data) => {
        if (data.kycReady) {
          toast({
            title: "Identity verified",
            description: "Add your bank or mobile money account to receive payouts.",
          });
        }
      })
      .catch(() => {
        /* non-critical */
      });
  }, [user?.inflowSubMerchantId, syncKyc, toast]);

  const startOnboarding = async () => {
    if (!isInflowPayoutCountry(country)) {
      toast({
        variant: "destructive",
        title: "Country not supported",
        description: "Pick a supported African country for Inflowpay payouts.",
      });
      return;
    }
    const inflowCode = toInflowCountryCode(country);
    if (!inflowCode) return;
    setBusy(true);
    try {
      const callable = httpsCallable(functions, "createInflowSubMerchant");
      const res = await callable({ country: inflowCode });
      const data = res.data as {
        nextUrl?: string | null;
        kycReady?: boolean;
      };
      await refreshAuthUser();
      if (data.nextUrl && !data.kycReady) {
        window.location.href = data.nextUrl;
        return;
      }
      toast({
        title: data.kycReady ? "Already verified" : "Inflowpay account created",
        description: data.kycReady
          ? "Add your payout destination below."
          : "Continue verification when prompted.",
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not start onboarding.";
      toast({ variant: "destructive", title: "Inflowpay", description: message });
    } finally {
      setBusy(false);
    }
  };

  const continueKyc = async () => {
    setBusy(true);
    try {
      const data = await syncKyc();
      if (data.nextUrl && !data.kycReady) {
        window.location.href = data.nextUrl;
        return;
      }
      toast({
        title: data.kycReady ? "Verification complete" : "Still in review",
        description: data.kycReady
          ? "You can add your payout account now."
          : "Check back shortly or continue the verification flow.",
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not refresh status.";
      toast({ variant: "destructive", title: "Verification", description: message });
    } finally {
      setBusy(false);
    }
  };

  const loadBankForm = async () => {
    setLoadingBankForm(true);
    try {
      const callable = httpsCallable(functions, "getInflowBankForm");
      const res = await callable();
      const data = res.data as { form?: Record<string, unknown> };
      const form = data.form || {};
      setBankForm(form);
      setBankFields(extractBankFields(form));
      setBankValues({});
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not load bank form.";
      toast({ variant: "destructive", title: "Bank setup", description: message });
    } finally {
      setLoadingBankForm(false);
    }
  };

  const submitBankAccount = async () => {
    setBusy(true);
    try {
      const callable = httpsCallable(functions, "registerInflowBankAccount");
      await callable({ fields: bankValues });
      await refreshAuthUser();
      setBankForm(null);
      toast({
        title: "Payout account saved",
        description: "You can withdraw wallet earnings to this account.",
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not save account.";
      toast({ variant: "destructive", title: "Bank setup", description: message });
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = useMemo(() => {
    if (ready) {
      return (
        <Badge className="bg-green-500 hover:bg-green-600 text-white">
          <CheckCircle className="mr-1 h-3 w-3" />
          Ready for payouts
        </Badge>
      );
    }
    if (kycReady && !hasPayoutAccount) {
      return (
        <Badge variant="secondary">
          <Smartphone className="mr-1 h-3 w-3" />
          Add payout account
        </Badge>
      );
    }
    if (hasSubMerchant) {
      return (
        <Badge variant="secondary">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Verification in progress
        </Badge>
      );
    }
    return <Badge variant="outline">Not connected</Badge>;
  }, [ready, kycReady, hasPayoutAccount, hasSubMerchant]);

  if (!user) return null;

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          Connect Bank for Payouts
        </CardTitle>
        <CardDescription>
          Verza uses Inflowpay to pay creators in Africa via bank transfer and
          mobile money (M-PESA, MTN, etc.).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
          {statusBadge}
          {user.inflowPayoutCountry && (
            <p className="text-xs text-muted-foreground">
              Payout country:{" "}
              {getInflowCountryDisplayName(user.inflowPayoutCountry) ||
                user.inflowPayoutCountry}
            </p>
          )}
          {kycReady ? (
            <p className="text-sm flex items-center text-green-600">
              <CheckCircle className="mr-2 h-4 w-4" />
              Identity verified
            </p>
          ) : hasSubMerchant ? (
            <p className="text-sm flex items-center text-amber-600">
              <XCircle className="mr-2 h-4 w-4" />
              Complete identity verification to enable payouts
            </p>
          ) : null}
        </div>

        {!hasSubMerchant && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inflow-country">Bank / mobile money country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="inflow-country">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {INFLOW_COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c.iso2} value={c.iso2}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full sm:w-auto" onClick={startOnboarding} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Connect with Inflowpay
            </Button>
          </div>
        )}

        {hasSubMerchant && !kycReady && (
          <Button variant="secondary" onClick={continueKyc} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            Continue verification
          </Button>
        )}

        {kycReady && !hasPayoutAccount && (
          <div className="space-y-3 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">Payout destination</p>
            <p className="text-sm text-muted-foreground">
              Add the bank account or mobile money wallet where you want to receive
              earnings.
            </p>
            {!bankForm ? (
              <Button
                variant="outline"
                onClick={loadBankForm}
                disabled={loadingBankForm}
              >
                {loadingBankForm ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Set up payout account
              </Button>
            ) : (
              <div className="space-y-3">
                {bankFields.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Enter your account details as required for your country.
                  </p>
                )}
                {bankFields.map((field, index) => {
                  const key = field.name || field.key || `field_${index}`;
                  const label = field.label || key;
                  if (field.type === "select" && field.options?.length) {
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={key}>{label}</Label>
                        <Select
                          value={bankValues[key] || ""}
                          onValueChange={(v) =>
                            setBankValues((prev) => ({ ...prev, [key]: v }))
                          }
                        >
                          <SelectTrigger id={key}>
                            <SelectValue placeholder={field.placeholder || "Select"} />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={key}>{label}</Label>
                      <Input
                        id={key}
                        value={bankValues[key] || ""}
                        onChange={(e) =>
                          setBankValues((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        placeholder={field.placeholder}
                        required={field.required}
                      />
                    </div>
                  );
                })}
                {bankFields.length === 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="accountDetails">Account details (JSON)</Label>
                    <Input
                      id="accountDetails"
                      placeholder='If fields are empty, contact support@tryverza.com'
                      disabled
                    />
                  </div>
                )}
                <Button onClick={submitBankAccount} disabled={busy}>
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save payout account
                </Button>
              </div>
            )}
          </div>
        )}

        {hasPayoutAccount && (
          <p className="text-sm text-muted-foreground">
            Payout account connected. Withdraw campaign earnings from your{" "}
            <a href="/wallet" className="underline underline-offset-2">
              Verza Wallet
            </a>
            .
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Store sales and contract payments still use Stripe for now. Phase 1 covers
          wallet withdrawals to your local bank or mobile money.
        </p>
      </CardContent>
    </Card>
  );
}
