"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import { GmailConnectCard } from "@/components/optic/gmail-connect-card";
import { OpticSmsCard } from "@/components/optic/optic-sms-card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Props = {
  gmailConnected: boolean;
  gmailEmail: string | null;
  smsEnabled: boolean;
  smsPhone: string | null;
  /** Public /sms-opt-in page: expanded integrations UI, no OAuth / save. */
  preview?: boolean;
};

function integrationsNeedSetup(
  gmailConnected: boolean,
  smsEnabled: boolean,
  smsPhone: string | null
): boolean {
  if (!gmailConnected) return true;
  if (smsEnabled && !smsPhone?.trim()) return true;
  return false;
}

function IntegrationSummary({
  gmailConnected,
  gmailEmail,
  smsEnabled,
  smsPhone,
}: Props) {
  const gmailLabel = gmailConnected
    ? `Gmail · ${gmailEmail ?? "connected"}`
    : "Gmail · not connected";

  let smsLabel = "Texts · off";
  if (smsEnabled && smsPhone?.trim()) {
    smsLabel = `Texts on · ${smsPhone.trim()}`;
  } else if (smsEnabled) {
    smsLabel = "Texts · add number";
  }

  return (
    <span className="hidden min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground sm:flex">
      <span className={cn(!gmailConnected && "text-amber-700 dark:text-amber-400")}>
        {gmailLabel}
      </span>
      <span
        className={cn(
          smsEnabled && !smsPhone?.trim() && "text-amber-700 dark:text-amber-400"
        )}
      >
        {smsLabel}
      </span>
    </span>
  );
}

export function OpticIntegrationsSection(props: Props) {
  const { preview = false } = props;
  const needsSetup = useMemo(
    () => integrationsNeedSetup(props.gmailConnected, props.smsEnabled, props.smsPhone),
    [props.gmailConnected, props.smsEnabled, props.smsPhone]
  );

  const [open, setOpen] = useState(preview || needsSetup);

  useEffect(() => {
    if (!preview) setOpen(needsSetup);
  }, [needsSetup, preview]);

  const isOpen = preview ? true : open;

  return (
    <Collapsible open={isOpen} onOpenChange={preview ? () => {} : setOpen}>
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <CollapsibleTrigger
          className={
            preview
              ? "flex w-full cursor-default items-center gap-3 rounded-lg p-4 text-left [&[data-state=open]>svg.chevron]:rotate-180"
              : "flex w-full items-center gap-3 rounded-lg p-4 text-left hover:bg-muted/40 [&[data-state=open]>svg.chevron]:rotate-180"
          }
        >
          <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Integrations</p>
            <p className="text-xs text-muted-foreground sm:hidden">
              Gmail &amp; text alerts
            </p>
          </div>
          <IntegrationSummary {...props} />
          <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-4 border-t p-4 md:grid-cols-2">
            <GmailConnectCard
              connected={props.gmailConnected}
              email={props.gmailEmail}
              disabled={preview}
            />
            <OpticSmsCard
              enabled={props.smsEnabled}
              phone={props.smsPhone}
              preview={preview}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
