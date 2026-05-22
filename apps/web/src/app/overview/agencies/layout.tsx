import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verza for agencies — overview",
  description:
    "Agency velocity on Verza: roster management, contract workflows, automated invoice follow-ups, automatic payment splits, and campaign funding—so teams get talent rostered and cash collected faster.",
  openGraph: {
    title: "Verza for agencies — overview deck",
    description:
      "Roster faster, collect faster: disciplined invoice reminders without rewriting net terms, plus splits, contracts, and programs in one workspace.",
    type: "website",
  },
};

export default function AgencyOverviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
