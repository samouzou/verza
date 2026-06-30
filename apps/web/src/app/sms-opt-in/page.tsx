import Image from "next/image";
import Link from "next/link";

import {
  SMS_LEGAL_ENTITY,
  SMS_OPT_IN_CHECKBOX_LABEL,
  SMS_OPT_IN_NOT_REQUIRED,
  SMS_PRIVACY_POLICY_URL,
  SMS_TERMS_URL,
} from "@/lib/sms-opt-in-disclosure";

const SUPPORT = "mailto:support@tryverza.com";

/**
 * Public SMS program disclosure for Twilio toll-free / A2P verification (e.g. error 30509).
 * Must stay reachable without login.
 */
export default function SmsOptInPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-slate-900">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/verza-icon.svg" alt="Verza" width={40} height={40} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {SMS_LEGAL_ENTITY} · Verza Optic
              </p>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 sm:text-3xl">
                SMS opt-in & program details
              </h1>
            </div>
          </div>
          <Link
            href="/login"
            className="text-sm font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            Sign in to Verza
          </Link>
        </header>

        <div className="rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
          <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              What you are opting in to
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {SMS_LEGAL_ENTITY} may send <strong>optional transactional text messages</strong> about
              your Verza account and <strong>Optic</strong> discovery activity—for example, when a batch
              you ran finishes processing. Messages go only to the mobile number you save, and only if
              you separately check the agreement below in the app. We do not use this channel for
              promotions or third-party marketing.
            </p>
            <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-200">
              {SMS_OPT_IN_NOT_REQUIRED}
            </p>
          </div>

          <div className="space-y-8 px-6 py-8 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Affirmative opt-in (checkbox)
              </h3>
              <p className="mt-2">
                Before any message is sent, the user must check an <strong>unchecked</strong> box in
                the signed-in Verza app with this exact agreement text next to the checkbox:
              </p>
              <div className="mt-4 flex gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-900">
                <span className="shrink-0 text-lg leading-none text-slate-500" aria-hidden>
                  ☐
                </span>
                <p className="text-sm leading-snug text-slate-800 dark:text-slate-200">
                  {SMS_OPT_IN_CHECKBOX_LABEL}
                </p>
              </div>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                How consent is collected (opt-in)
              </h3>
              <p className="mt-2">
                Consent is collected <strong>inside the signed-in Verza web application</strong> before
                any SMS is sent:
              </p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>
                  Sign in at{" "}
                  <Link
                    href="/login"
                    className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                  >
                    Verza
                  </Link>
                  .
                </li>
                <li>
                  Open <strong>Optic</strong> and the integrations area labeled{" "}
                  <strong>Text updates (optional)</strong>.
                </li>
                <li>
                  Optionally enter your <strong>mobile number</strong> (for example +1 555 123 4567).
                </li>
                <li>
                  To receive texts, check the box with the agreement wording shown above (starts{" "}
                  <strong>unchecked</strong> until you opt in).
                </li>
                <li>
                  Click <strong>Save text settings</strong>. Until you check that box and save with a
                  valid number, we do not send Optic completion texts to that number.
                </li>
                <li>
                  When you start a discovery run, a completion text is only sent if you have already
                  completed the steps above; there is no separate requirement to receive SMS to run
                  Optic.
                </li>
              </ol>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Message content & frequency
              </h3>
              <p className="mt-2">
                When a batch completes, you may receive a short status text similar to:
              </p>
              <blockquote className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                Batch [n] complete: [count] creator(s) saved. Reply CONTINUE for another batch, STOP
                to opt out, HELP for help. [link to your Optic vault]
              </blockquote>
              <p className="mt-3">
                <strong>Frequency:</strong> varies with how often you run batches you opted into; not
                sent on a fixed marketing schedule. Message and data rates may apply.
              </p>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Reply keywords (STOP / HELP / CONTINUE)
              </h3>
              <p className="mt-2">From the same enrolled number, you may reply:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <strong>STOP</strong> (or UNSUBSCRIBE, CANCEL, END) to turn off Optic text updates for
                  that number. We confirm opt-out in a follow-up text; you can re-enable anytime in the
                  app under Text updates.
                </li>
                <li>
                  <strong>HELP</strong> for a short information message about this program.
                </li>
                <li>
                  <strong>CONTINUE</strong> (or YES, MORE, NEXT, GO) to request another discovery batch
                  when supported by your account and recent job state.
                </li>
              </ul>
              <p className="mt-3 text-slate-600 dark:text-slate-400">
                For help with your account or messages, contact{" "}
                <a
                  href={SUPPORT}
                  className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                >
                  support@tryverza.com
                </a>
                .
              </p>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Cost & carriers
              </h3>
              <p className="mt-2">
                Message and data rates may apply according to your mobile plan. Carriers are not liable
                for delayed or undelivered messages. Supported carriers are subject to change; delivery
                is not guaranteed in all regions.
              </p>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Privacy & terms
              </h3>
              <p className="mt-2">
                Our handling of personal data—including phone numbers—is described in our{" "}
                <a
                  href={SMS_PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                >
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a
                  href={SMS_TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                >
                  Terms of Service
                </a>
                .
              </p>
            </section>

            <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="text-sm font-medium">For verification reviewers</p>
              <p className="mt-1 text-sm">
                This URL is intentionally public and requires no password. It documents the same
                in-product checkbox consent used before {SMS_LEGAL_ENTITY} sends any Optic-related SMS.
              </p>
            </section>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
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
