import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS opt-in — Verza Optic",
  description:
    "Verza Technologies, Inc.: optional transactional Optic SMS, affirmative checkbox opt-in in-app, STOP/HELP/CONTINUE, Privacy Policy and Terms links. Public page for toll-free verification.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "SMS opt-in — Verza Optic",
    description:
      "Transactional batch notices from Verza Technologies, Inc. Checkbox opt-in in the Verza app before any SMS is sent. Not required to use the service.",
    type: "website",
  },
};

export default function SmsOptInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
