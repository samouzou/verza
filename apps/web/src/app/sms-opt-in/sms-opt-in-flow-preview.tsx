"use client";

import Image from "next/image";
import Link from "next/link";

import { OpticIntegrationsSection } from "@/components/optic/optic-integrations-section";
import {
  SMS_LEGAL_ENTITY,
  SMS_OPT_IN_NOT_REQUIRED,
  SMS_PRIVACY_POLICY_URL,
  SMS_TERMS_URL,
} from "@/lib/sms-opt-in-disclosure";

const SUPPORT = "mailto:support@tryverza.com";

/**
 * Public SMS disclosure for Twilio toll-free verification.
 * Renders the same Optic integrations UI as /optic (preview mode — no login).
 */
export function SmsOptInFlowPreview() {
  return (
    <div className="min-h-screen bg-background py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/verza-icon.svg" alt="Verza" width={40} height={40} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {SMS_LEGAL_ENTITY} · Verza Optic
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">SMS opt-in & program details</h1>
            </div>
          </div>
          <Link
            href="/login"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in to Verza
          </Link>
        </header>

        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Live in-app consent flow (no login required)</p>
          <p className="mt-1 text-muted-foreground">
            The <strong>Integrations → Text updates (optional)</strong> panel below is the same component
            signed-in users see on{" "}
            <Link href="/optic" className="font-medium text-primary underline-offset-2 hover:underline">
              Verza Optic
            </Link>
            . You can enter a number, check the agreement box, and click <strong>Save text settings</strong> to
            confirm the flow. Nothing is stored on this public page.
          </p>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Verza Optic</h2>
            <p className="text-sm text-muted-foreground">
              Run creator discovery batches. Optional text alerts appear under Integrations when you expand
              the panel — same placement as in the product.
            </p>
          </div>
          <OpticIntegrationsSection
            preview
            gmailConnected={false}
            gmailEmail={null}
            smsEnabled={false}
            smsPhone={null}
          />
        </section>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="border-b px-6 py-5">
            <h2 className="text-lg font-semibold">Program disclosure</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {SMS_LEGAL_ENTITY} sends <strong>optional transactional text messages</strong> about your
              Verza account and Optic discovery activity—for example, when a batch you ran finishes
              processing. Messages go only to the mobile number you save, and only after you check the
              agreement and click <strong>Save text settings</strong>. We do not use this channel for
              promotions or third-party marketing.
            </p>
            <p className="mt-3 text-sm font-medium">{SMS_OPT_IN_NOT_REQUIRED}</p>
          </div>

          <div className="space-y-8 px-6 py-8 text-sm leading-relaxed text-muted-foreground">
            <section>
              <h3 className="text-base font-semibold text-foreground">Signed-in flow (summary)</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>
                  Sign in at{" "}
                  <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
                    Verza
                  </Link>
                  .
                </li>
                <li>
                  Open <strong>Optic</strong> and expand <strong>Integrations</strong>.
                </li>
                <li>
                  Under <strong>Text updates (optional)</strong>, enter your mobile number (for example +1
                  555 123 4567).
                </li>
                <li>
                  Check the agreement box (starts <strong>unchecked</strong>) and click{" "}
                  <strong>Save text settings</strong>.
                </li>
              </ol>
            </section>

            <section>
              <h3 className="text-base font-semibold text-foreground">Sample message</h3>
              <blockquote className="mt-3 rounded-md border bg-muted/40 p-4 font-mono text-xs text-foreground">
                Batch [n] complete: [count] creator(s) saved. Reply CONTINUE for another batch, STOP to opt
                out, HELP for help. [link to your Optic vault]
              </blockquote>
              <p className="mt-3">
                <strong>Frequency:</strong> varies with how often you run batches you opted into. Message and
                data rates may apply.
              </p>
            </section>

            <section>
              <h3 className="text-base font-semibold text-foreground">Reply keywords</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <strong>STOP</strong> (or UNSUBSCRIBE, CANCEL, END) to turn off Optic text updates.
                </li>
                <li>
                  <strong>HELP</strong> for program information.
                </li>
                <li>
                  <strong>CONTINUE</strong> (or YES, MORE, NEXT, GO) to request another discovery batch when
                  supported.
                </li>
              </ul>
              <p className="mt-3">
                Questions:{" "}
                <a href={SUPPORT} className="font-medium text-primary underline-offset-2 hover:underline">
                  support@tryverza.com
                </a>
              </p>
            </section>

            <section>
              <h3 className="text-base font-semibold text-foreground">Privacy & terms</h3>
              <p className="mt-2">
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
            </section>

            <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="text-sm font-medium">For verification reviewers</p>
              <p className="mt-1 text-sm">
                This URL is public with no password. The integrations panel above uses the production React
                components from the Verza app; checkbox consent is required before {SMS_LEGAL_ENTITY} sends
                any Optic-related SMS to a saved number.
              </p>
            </section>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="underline-offset-2 hover:underline">
            Home
          </Link>
          {" · "}
          <Link href="/data-deletion" className="underline-offset-2 hover:underline">
            Data deletion
          </Link>
        </p>
      </div>
    </div>
  );
}
