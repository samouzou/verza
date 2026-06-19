import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "World App × Cannes Lions — Humanity Hub",
  description:
    "World App activation at Cannes Lions 2026: proof-of-humanity protocol, verified VIP access, and $60K corporate partnership scope.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "World App × Cannes Lions — Humanity Hub",
    description:
      "The Identity Layer for the Creative Capital. Anchoring elite trust in the age of AI at Cannes Lions 2026.",
    type: "website",
  },
};

export default function CannesWorldAppLayout({ children }: { children: React.ReactNode }) {
  return <div className={inter.className}>{children}</div>;
};
