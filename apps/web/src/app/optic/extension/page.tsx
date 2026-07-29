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
          A small Chrome add-on that lets Optic find Instagram creators through your own
          signed-in browser. Instagram only shows follower counts, bios, and contact
          details to people who are signed in, so this is what gets you the real numbers.
        </p>
      </div>

      <Card className="border-violet-200/80 bg-violet-50/40 dark:border-violet-900/50 dark:bg-violet-950/20">
        <CardHeader>
          <CardTitle className="text-lg">Add it to Chrome</CardTitle>
          <CardDescription>
            {fromStore
              ? "One click from the Chrome Web Store."
              : "Early access — a one-time setup that takes about a minute."}
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
                    Download for Chrome
                  </>
                )}
              </a>
            </Button>
          )}

          {!fromStore && (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Download the file above, then unzip it. On a Mac, double-click it. On Windows, right-click and choose <strong>Extract All</strong>.</li>
              <li>Open a new tab in Chrome and go to <code className="text-xs">chrome://extensions</code></li>
              <li>Turn on <strong>Developer mode</strong> with the switch in the top-right corner</li>
              <li>Choose <strong>Load unpacked</strong>, then pick the folder you just unzipped</li>
              <li>Sign in to Instagram in this same Chrome window</li>
              <li>
                Come back to{" "}
                <Link href="/optic" className="text-primary underline-offset-4 hover:underline">
                  Optic
                </Link>
                , pick Instagram, and choose <strong>Check again</strong>
              </li>
            </ol>
          )}

          {fromStore && (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Choose <strong>Add to Chrome</strong> above and confirm</li>
              <li>Sign in to Instagram in this same Chrome window</li>
              <li>
                Open{" "}
                <Link href="/optic" className="text-primary underline-offset-4 hover:underline">
                  Optic
                </Link>
                , pick Instagram, and tick <strong>Search Instagram using my browser</strong>
              </li>
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            When you start an Instagram mission in Optic, the add-on opens a few Instagram
            pages in Chrome and reads what&apos;s publicly on each creator&apos;s profile —
            their follower count, bio, and any contact details they&apos;ve shared. Good
            matches get a personalized outreach draft and land in your creator vault.
          </p>
          <p>
            It works through the Instagram account you&apos;re already signed in to, so you
            never share your password with Verza. It only reads profiles: it never posts,
            comments, follows, or messages anyone on your behalf.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Instagram only</Badge>
            <Badge variant="secondary">Runs in your browser</Badge>
            <Badge variant="secondary">Never sees your password</Badge>
            <Badge variant="secondary">Reads only — never posts</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
