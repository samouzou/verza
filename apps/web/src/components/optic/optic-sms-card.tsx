"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { httpsCallable } from "firebase/functions";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import {
  SMS_LEGAL_ENTITY,
  SMS_OPT_IN_CHECKBOX_LABEL,
  SMS_OPT_IN_NOT_REQUIRED,
  SMS_PRIVACY_POLICY_URL,
  SMS_TERMS_URL,
} from "@/lib/sms-opt-in-disclosure";

type Props = {
  enabled: boolean;
  phone: string | null;
  disabled?: boolean;
};

export function OpticSmsCard({ enabled: enabledInitial, phone: phoneInitial, disabled }: Props) {
  const { toast } = useToast();
  const [consent, setConsent] = useState(enabledInitial);
  const [phone, setPhone] = useState(phoneInitial ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConsent(enabledInitial);
    setPhone(phoneInitial ?? "");
  }, [enabledInitial, phoneInitial]);

  const save = useCallback(async () => {
    if (consent && !phone.trim()) {
      toast({
        variant: "destructive",
        title: "Mobile number required",
        description: "Enter a mobile number to turn on text updates, or leave the agreement unchecked.",
      });
      return;
    }
    setSaving(true);
    try {
      const callable = httpsCallable(functions, "setOpticSmsSettings");
      await callable({ phone: phone.trim() || undefined, enabled: consent });
      toast({ title: "Text settings saved" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save text settings.";
      toast({ variant: "destructive", title: "Text settings", description: message });
    } finally {
      setSaving(false);
    }
  }, [consent, phone, toast]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          Text updates (optional)
        </CardTitle>
        <CardDescription>
          Optional transactional texts from {SMS_LEGAL_ENTITY} when an Optic discovery batch finishes.
          Reply <strong>STOP</strong> to opt out, <strong>HELP</strong> for help, or{" "}
          <strong>CONTINUE</strong> to start another batch when your account supports it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          You do not need text messages to use Verza or Optic. Turn them on only if you want batch
          completion notices on your phone.
        </p>
        <div className="space-y-2">
          <Label htmlFor="optic-sms-phone">Mobile number (optional)</Label>
          <Input
            id="optic-sms-phone"
            type="tel"
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={disabled}
          />
        </div>
        <SmsConsentRow consent={consent} setConsent={setConsent} disabled={disabled} />
        <p className="text-xs text-muted-foreground leading-relaxed">{SMS_OPT_IN_NOT_REQUIRED}</p>
        <p className="text-xs text-muted-foreground">
          <a
            href={SMS_PRIVACY_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Privacy Policy
          </a>
          {" · "}
          <a
            href={SMS_TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Terms of Service
          </a>
        </p>
        <Button type="button" size="sm" disabled={disabled || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save text settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SmsConsentRow({
  consent,
  setConsent,
  disabled,
}: {
  consent: boolean;
  setConsent: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-muted/30 p-3">
      <Checkbox
        id="optic-sms-consent"
        checked={consent}
        onCheckedChange={(v) => setConsent(v === true)}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
      <Label htmlFor="optic-sms-consent" className="cursor-pointer text-sm font-normal leading-snug">
        {SMS_OPT_IN_CHECKBOX_LABEL}
      </Label>
    </div>
  );
}
