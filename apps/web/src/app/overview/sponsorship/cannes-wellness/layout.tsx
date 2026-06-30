import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Verza × Yellow Party — Cannes Lions Wellness Takeover",
  description:
    "Exclusive wellness and beauty partner slot at LIONS Creator Beach, Cannes — June 24, 2026. $25K turn-key package.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Verza × Yellow Party — Cannes Lions Wellness Takeover",
    description:
      "The Cannes Lions Wellness Takeover — LIONS Creator Beach, June 24, 2026. Premium partner opportunity.",
    type: "website",
  },
};

export default function CannesWellnessSponsorshipLayout({ children }: { children: React.ReactNode }) {
  return <div className={inter.className}>{children}</div>;
}
