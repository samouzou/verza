"use client";

import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useOpticGmail } from "@/hooks/use-optic-gmail";

type Props = {
  connected: boolean;
  email: string | null;
  disabled?: boolean;
};

export function GmailConnectCard({ connected, email, disabled }: Props) {
  const gmail = useOpticGmail({ connected, email });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          Gmail
        </CardTitle>
        <CardDescription>
          Connect Gmail so Optic can push outreach drafts into your Gmail Drafts folder. We only request
          permission to create drafts — not to send mail for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ConnectStatus connected={connected} email={email} />
        <ConnectActions
          connected={connected}
          disabled={disabled}
          connecting={gmail.connecting}
          disconnecting={gmail.disconnecting}
          onConnect={() => void gmail.connect()}
          onDisconnect={() => void gmail.disconnect()}
        />
      </CardContent>
    </Card>
  );
}

function ConnectStatus({
  connected,
  email,
}: {
  connected: boolean;
  email: string | null;
}) {
  if (connected && email) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        Connected as <span className="font-medium text-foreground">{email}</span>
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Not connected — vault leads can still be copied; connect to push drafts to Gmail.
    </p>
  );
}

function ConnectActions({
  connected,
  disabled,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
}: {
  connected: boolean;
  disabled?: boolean;
  connecting: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (connected) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || disconnecting}
        onClick={onDisconnect}
      >
        {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      disabled={disabled || connecting}
      onClick={onConnect}
    >
      {connecting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Redirecting…
        </>
      ) : (
        "Connect Gmail"
      )}
    </Button>
  );
}
