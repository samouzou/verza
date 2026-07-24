import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verza — event sponsorship",
  description:
    "Sponsorship overview for a private San Francisco brief on automating the creator pipeline: audience, fireside, and partnership tiers.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Verza × Google Gemini — sponsorship",
    description:
      "High-Velocity Growth: Automating the Creator Pipeline—Verza HQ, San Francisco, June 25, 2026. Sponsorship packages and audience overview.",
    type: "website",
  },
};

export default function SponsorshipDeckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
