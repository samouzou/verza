"use client";

import Link from "next/link";
import { ArrowLeft, Chrome, Download, ExternalLink } from "lucide-react";
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
  getOpticExtensionPrimaryInstallUrl,
  isChromeWebStoreInstall,
  OPTIC_EXTENSION_CHROME_STORE_URL,
  OPTIC_EXTENSION_DOWNLOAD_URL,
} from "@/lib/optic/extension-install";

export default function OpticExtensionInstallPage() {
  const installUrl = getOpticExtensionPrimaryInstallUrl();
  const fromStore = isChromeWebStoreInstall();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/optic">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Optic
        </Link>
      </Button>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Chrome className="h-6 w-6 text-violet-600" />
          <h1 className="text-2xl font-semibold tracking-tight">Verza Optic Scout</h1>
        </div>
        <p className="text-muted-foreground">
          Chrome extension for Instagram creator discovery in your logged-in browser.
          Required for follower counts, bios, and contact info that headless search cannot access.
        </p>
      </div>

      <Card className="border-violet-200/80 bg-violet-50/40 dark:border-violet-900/50 dark:bg-violet-950/20">
        <CardHeader>
          <CardTitle className="text-lg">Install the extension</CardTitle>
          <CardDescription>
            {fromStore
              ? "One click from the Chrome Web Store — recommended for all users."
              : "Early access: download the extension package, then load it in Chrome."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {installUrl && (
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={installUrl} target="_blank" rel="noopener noreferrer">
                {fromStore ? (
                  <>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Add to Chrome
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Download extension (.zip)
                  </>
                )}
              </a>
            </Button>
          )}

          {!fromStore && (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Download and unzip <code className="text-xs">verza-optic-scout.zip</code></li>
              <li>Open <code className="text-xs">chrome://extensions</code></li>
              <li>Enable <strong>Developer mode</strong> (top right)</li>
              <li>Click <strong>Load unpacked</strong> and select the unzipped folder</li>
              <li>Log into Instagram in the same Chrome profile</li>
              <li>
                Return to{" "}
                <Link href="/optic" className="text-primary underline-offset-4 hover:underline">
                  Optic
                </Link>
                , choose Instagram, and click Recheck extension
              </li>
            </ol>
          )}

          {fromStore && (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Click <strong>Add to Chrome</strong> above and confirm the install</li>
              <li>Log into Instagram in the same Chrome profile</li>
              <li>
                Open{" "}
                <Link href="/optic" className="text-primary underline-offset-4 hover:underline">
                  Optic
                </Link>
                , choose Instagram, and enable <strong>Use my browser for Instagram search</strong>
              </li>
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What it does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            When you start an Instagram mission from Optic, the extension opens hashtag and profile
            pages in background Chrome tabs using your existing Instagram login. Scraped profiles are
            enriched and saved to your Optic vault through Verza&apos;s cloud APIs.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Instagram only</Badge>
            <Badge variant="secondary">Runs in your browser</Badge>
            <Badge variant="secondary">No password sharing</Badge>
          </div>
        </CardContent>
      </Card>

      {!fromStore && OPTIC_EXTENSION_CHROME_STORE_URL === "" && (
        <p className="text-xs text-muted-foreground">
          A Chrome Web Store listing is coming soon. Until then, use the download above.
          {OPTIC_EXTENSION_DOWNLOAD_URL.startsWith("/") && (
            <>
              {" "}
              Package URL:{" "}
              <code className="text-xs">{OPTIC_EXTENSION_DOWNLOAD_URL}</code>
            </>
          )}
        </p>
      )}
    </div>
  );
}
