import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verza — event sponsorship",
  description:
    "Sponsorship overview for an exclusive San Francisco evening: audience, VIP dinner, and partnership tiers.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Verza × Stripe — sponsorship",
    description:
      "Creator ops, AI, and global payouts—San Francisco, June 17, 2026. Sponsorship packages and audience overview.",
    type: "website",
  },
};

export default function SponsorshipDeckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
