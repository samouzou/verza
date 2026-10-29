import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Redeem AppSumo · Prism",
  description: "Enter your AppSumo code to unlock Prism Lifetime on Verza.",
  robots: { index: false, follow: false },
};

export default function PrismRedeemLayout({ children }: { children: ReactNode }) {
  return children;
}
