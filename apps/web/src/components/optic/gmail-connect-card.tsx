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
  canRead?: boolean;
  disabled?: boolean;
};

export function GmailConnectCard({ connected, email, canRead, disabled }: Props) {
  const gmail = useOpticGmail({ connected, email });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          Gmail
        </CardTitle>
        <CardDescription>
          Connect Gmail to draft, send, and read replies on threads you start from Verza.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ConnectStatus connected={connected} email={email} canRead={canRead} />
        <ConnectActions
          connected={connected}
          canRead={canRead}
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
  canRead,
}: {
  connected: boolean;
  email: string | null;
  canRead?: boolean;
}) {
  if (connected && email) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        Connected as <span className="font-medium text-foreground">{email}</span>
        {canRead
          ? " · can read replies"
          : " · reconnect to see replies"}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Not connected — you can still copy drafts. Connect to send from Verza.
    </p>
  );
}

function ConnectActions({
  connected,
  canRead,
  disabled,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
}: {
  connected: boolean;
  canRead?: boolean;
  disabled?: boolean;
  connecting: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (connected) {
    return (
      <div className="flex flex-wrap gap-2">
        {!canRead && (
          <Button
            type="button"
            size="sm"
            disabled={disabled || connecting}
            onClick={onConnect}
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reconnect for replies"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || disconnecting}
          onClick={onDisconnect}
        >
          {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
        </Button>
      </div>
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
