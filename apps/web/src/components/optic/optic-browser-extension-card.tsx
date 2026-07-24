"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Chrome, Download, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getOpticExtensionInstallUrl,
  getOpticExtensionPrimaryInstallUrl,
  isChromeWebStoreInstall,
  OPTIC_EXTENSION_INSTALL_PATH,
} from "@/lib/optic/extension-install";
import {
  pingOpticExtension,
  type OpticExtensionStatus,
} from "@/lib/optic/extension-bridge";

type Props = {
  instagramSelected: boolean;
  useExtension: boolean;
  onUseExtensionChange: (value: boolean) => void;
};

export function OpticBrowserExtensionCard({
  instagramSelected,
  useExtension,
  onUseExtensionChange,
}: Props) {
  const [status, setStatus] = useState<OpticExtensionStatus>({ installed: false });
  const [checking, setChecking] = useState(true);
  const installUrl = getOpticExtensionPrimaryInstallUrl();
  const fromStore = isChromeWebStoreInstall();

  const refresh = useCallback(async () => {
    setChecking(true);
    const next = await pingOpticExtension();
    setStatus(next);
    setChecking(false);
    if (!next.installed && useExtension) {
      onUseExtensionChange(false);
    }
  }, [onUseExtensionChange, useExtension]);

  useEffect(() => {
    void refresh();

    const onReady = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { channel?: string; type?: string };
      if (data?.channel !== "verza-optic-extension" || data.type !== "VERZA_OPTIC_READY") return;
      void refresh();
    };

    const observer = new MutationObserver(() => {
      if (document.documentElement.hasAttribute("data-verza-optic-extension")) {
        void refresh();
      }
    });

    window.addEventListener("message", onReady);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-verza-optic-extension"],
    });

    return () => {
      window.removeEventListener("message", onReady);
      observer.disconnect();
    };
  }, [refresh]);

  if (!instagramSelected) return null;

  return (
    <Card className="border-violet-200/80 bg-violet-50/40 dark:border-violet-900/50 dark:bg-violet-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Chrome className="h-4 w-4 text-violet-600" />
          Chrome extension (recommended for Instagram)
        </CardTitle>
        <CardDescription>
          Instagram hides follower counts and contact info from headless browsers.
          The Optic extension runs discovery in your logged-in Chrome session.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {checking ? (
            <Badge variant="secondary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Checking extension…
            </Badge>
          ) : status.needsRefresh ? (
            <Badge variant="secondary">Extension needs page refresh</Badge>
          ) : status.installed ? (
            <Badge className="bg-green-600 hover:bg-green-600">
              Extension connected{status.version ? ` · v${status.version}` : ""}
            </Badge>
          ) : (
            <Badge variant="destructive">Extension not detected</Badge>
          )}
          {status.running && (
            <Badge variant="secondary">Mission running in Chrome</Badge>
          )}
        </div>

        {status.needsRefresh && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {status.error || "The extension was updated or reloaded. Refresh this page, then click Recheck."}
          </p>
        )}

        {!status.installed && !status.needsRefresh && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Install Verza Optic Scout in Chrome, log into Instagram, then return here.
            </p>
            <div className="flex flex-wrap gap-2">
              {installUrl && (
                <Button asChild size="sm">
                  <a href={installUrl} target="_blank" rel="noopener noreferrer">
                    {fromStore ? (
                      <>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Add to Chrome
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Download extension
                      </>
                    )}
                  </a>
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href={OPTIC_EXTENSION_INSTALL_PATH}>Install guide</Link>
              </Button>
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background/80 p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={useExtension}
            disabled={!status.installed}
            onChange={(e) => onUseExtensionChange(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Use my browser for Instagram search</span>
            <span className="mt-1 block text-muted-foreground">
              Opens Instagram tabs in the background while you stay on Verza. You must
              be logged into Instagram in Chrome.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            Recheck extension
          </Button>
          {!status.installed && (
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href={getOpticExtensionInstallUrl()}>Setup help</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
