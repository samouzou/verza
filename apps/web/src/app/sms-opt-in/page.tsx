import Image from "next/image";
import Link from "next/link";

const PRIVACY = "https://www.tryverza.com/privacy-policy";
const TERMS = "https://www.tryverza.com/terms-of-service";
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
                Verza · Optic
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
              Verza may send <strong>optional, transactional text messages</strong> related to{" "}
              <strong>Optic</strong>, our in-product creator discovery feature. Messages are sent only
              to the mobile number you save in your account, and only when you have explicitly turned
              on text updates and run discovery batches. We do not use this channel for marketing
              blasts or third-party promotions.
            </p>
          </div>

          <div className="space-y-8 px-6 py-8 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
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
                  Open <strong>Optic</strong> and the integrations / text updates area (labeled{" "}
                  <strong>Text updates</strong>).
                </li>
                <li>
                  Enter your <strong>mobile number</strong> in E.164 format (e.g. +1 555 123 4567).
                </li>
                <li>
                  Check the box <strong>“Text me when a batch completes”</strong>.
                </li>
                <li>
                  Click <strong>Save text settings</strong>. Until you complete these steps, we do not
                  send Optic completion texts to that number.
                </li>
                <li>
                  When you start a discovery run, you may also choose to receive a text when that{" "}
                  <em>specific</em> batch finishes (job-level notification). That choice is only
                  available if your number and text updates are already configured as above.
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
                Batch [n] done — [count] creator(s) in your vault. Reply CONTINUE for ~[batch size]
                more, STOP to pause texts, or open [link to your Optic vault]
              </blockquote>
              <p className="mt-3">
                <strong>Frequency:</strong> at most one completion text per finished batch you opted
                into via the job; otherwise only when you have enabled text updates and a qualifying
                batch completes. Volume depends on how often you run Optic jobs—not on a fixed
                marketing schedule.
              </p>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Reply keywords (STOP / CONTINUE)
              </h3>
              <p className="mt-2">
                From the same enrolled number, you may reply:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <strong>CONTINUE</strong> (or YES, MORE, NEXT, GO) to request another discovery batch
                  when supported by your account and recent job state.
                </li>
                <li>
                  <strong>STOP</strong> (or UNSUBSCRIBE, CANCEL, END) to turn off Optic text updates for
                  that number. We confirm opt-out in a follow-up text; you can re-enable anytime in the
                  app under Text updates.
                </li>
              </ul>
              <p className="mt-3 text-slate-600 dark:text-slate-400">
                For help with your account or messages, contact{" "}
                <a href={SUPPORT} className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400">
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
                  href={PRIVACY}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                >
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a
                  href={TERMS}
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
                in-product consent flow used before Verza sends any Optic-related SMS.
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
