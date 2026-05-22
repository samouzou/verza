import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS opt-in — Verza Optic",
  description:
    "How Verza collects consent to send optional Optic text updates when creator discovery batches complete. Public page for carrier and toll-free verification.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "SMS opt-in — Verza Optic",
    description:
      "Transactional SMS for Optic: batch completion notices. Consent is collected in-app before any message is sent.",
    type: "website",
  },
};

export default function SmsOptInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
