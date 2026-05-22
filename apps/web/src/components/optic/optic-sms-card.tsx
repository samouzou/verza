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

type Props = {
  enabled: boolean;
  phone: string | null;
  disabled?: boolean;
};

export function OpticSmsCard({ enabled: enabledInitial, phone: phoneInitial, disabled }: Props) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(enabledInitial);
  const [phone, setPhone] = useState(phoneInitial ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(enabledInitial);
    setPhone(phoneInitial ?? "");
  }, [enabledInitial, phoneInitial]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const callable = httpsCallable(functions, "setOpticSmsSettings");
      await callable({ phone: phone.trim() || undefined, enabled });
      toast({ title: "Text updates saved" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save text settings.";
      toast({ variant: "destructive", title: "Text updates", description: message });
    } finally {
      setSaving(false);
    }
  }, [enabled, phone, toast]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4" />
          Text updates
        </CardTitle>
        <CardDescription>
          Get a text when each batch finishes. Reply <strong>CONTINUE</strong> for another batch of
          creators, or <strong>STOP</strong> to pause.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SmsEnabledRow enabled={enabled} setEnabled={setEnabled} disabled={disabled} />
        <div className="space-y-2">
          <Label htmlFor="optic-sms-phone">Mobile number</Label>
          <Input
            id="optic-sms-phone"
            type="tel"
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={disabled}
          />
        </div>
        <Button type="button" size="sm" disabled={disabled || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save text settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SmsEnabledRow({
  enabled,
  setEnabled,
  disabled,
}: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="optic-sms-enabled"
        checked={enabled}
        onCheckedChange={(v) => setEnabled(v === true)}
        disabled={disabled}
      />
      <Label htmlFor="optic-sms-enabled" className="text-sm font-normal cursor-pointer">
        Text me when a batch completes
      </Label>
    </div>
  );
}
