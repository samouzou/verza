import type { LinkedInOsJobItem } from "./types";
import { DEFAULT_QUEUE_ITEMS } from "./types";

export type LinkedInOsInspirationSlot = {
  hook: string;
  productTruth: string;
  notes?: string;
};

export type LinkedInOsInspirationPreset = {
  id: string;
  label: string;
  description: string;
  slots: [LinkedInOsInspirationSlot, LinkedInOsInspirationSlot, LinkedInOsInspirationSlot];
};

/** Feature-led starting points for the default Tue / Wed / Thu queue. Edit before generating. */
export const LINKEDIN_OS_INSPIRATION_PRESETS: LinkedInOsInspirationPreset[] = [
  {
    id: "optic-discovery",
    label: "Optic — semantic discovery",
    description: "Creator scouting from campaign briefs, not keyword lists.",
    slots: [
      {
        hook: "Most brand teams still start creator search with keyword lists.",
        productTruth:
          "Optic runs creator discovery from a campaign brief and brand context—not a static keyword sheet.",
        notes: "Playbook angle: intent vs keywords.",
      },
      {
        hook: "We are tightening how Optic reads a brief before it scouts.",
        productTruth:
          "Optic drafts outreach from the campaign pay, scope, and brand guide already in Verza.",
        notes: "Build in public: recent mapping work, no invented metrics.",
      },
      {
        hook: "Beyond the keyword gap",
        productTruth:
          "Optic links discovery to campaigns in Verza so pay and scope stay attached to outreach.",
        notes: "Carousel: problem → how brief-led scout works → CTA to follow.",
      },
    ],
  },
  {
    id: "campaign-escrow",
    label: "Campaign vault & escrow",
    description: "Pre-funded campaigns and payout on approved work.",
    slots: [
      {
        hook: "Creators do not need another 'we'll pay you later' promise.",
        productTruth: "Verza campaigns are pre-funded before creators accept—escrow holds the budget until approval.",
        notes: "Operator playbook for brand-side trust.",
      },
      {
        hook: "Shipping the boring part of sponsored content: money that actually moves.",
        productTruth:
          "Payout runs when a brand approves a verified submission—not when someone remembers to invoice.",
        notes: "Receipts without quoting fees unless you add them manually.",
      },
      {
        hook: "What 'funded' should mean in creator deals",
        productTruth:
          "Agencies fund campaigns into escrow; creators see committed budget before they say yes.",
        notes: "Carousel: creator anxiety → escrow flow → soft CTA.",
      },
    ],
  },
  {
    id: "verza-score",
    label: "Verza Score quality gate",
    description: "AI feedback before brand review.",
    slots: [
      {
        hook: "Brand review should not be the first time anyone asks if the hook works.",
        productTruth:
          "Submissions can run through Verza Score simulation with actionable feedback before brand review.",
        notes: "Playbook: feedback beats a single pass/fail number.",
      },
      {
        hook: "We keep tuning what the score explains—not just what it outputs.",
        productTruth:
          "Verza Score is designed to surface why content hits or misses, not only a numeric result.",
        notes: "Build in public; avoid claiming accuracy stats.",
      },
      {
        hook: "Stop debating taste in the comments thread",
        productTruth:
          "Verza Score gives structured feedback brands can react to before payout decisions.",
        notes: "Carousel slides: messy review → score + feedback → workflow CTA.",
      },
    ],
  },
  {
    id: "agency-roster",
    label: "Agency roster & splits",
    description: "Roster creators and automate commission splits.",
    slots: [
      {
        hook: "Agencies should not rebuild commission math in a spreadsheet every payout.",
        productTruth:
          "Rostered creators carry a commission rate; Verza splits net payout between agency and talent on approval.",
        notes: "Playbook for agency operators.",
      },
      {
        hook: "Roster is infrastructure, not a contact list.",
        productTruth:
          "Agencies invite talent to a roster in Verza so deals, campaigns, and splits stay in one system.",
        notes: "Build in public: roster UX, no vanity metrics.",
      },
      {
        hook: "One roster. One payout event.",
        productTruth:
          "When a rostered creator is paid for a campaign, agency commission and creator net can route automatically.",
        notes: "Carousel: spreadsheet pain → roster → payout split diagram in words.",
      },
    ],
  },
  {
    id: "campaigns-workspace",
    label: "Campaigns workspace",
    description: "Briefs, applicants, and team notifications in one place.",
    slots: [
      {
        hook: "Campaign chaos usually lives in five tabs—not one brief.",
        productTruth:
          "Verza campaigns hold brief, applicants, and team workflow in a shared workspace—not scattered DMs.",
        notes: "Generic if your live product copy differs; edit productTruth.",
      },
      {
        hook: "We are wiring more of campaign ops into one surface.",
        productTruth:
          "Campaign updates and applicant flow are meant to stay inside Verza for the whole agency team.",
        notes: "Build in public; mention only shipped behavior you stand behind.",
      },
      {
        hook: "Your campaign brief should not expire in Slack",
        productTruth:
          "Campaigns in Verza keep scope and applicant status where the team already works.",
        notes: "Carousel: scattered tools → single workspace → follow/save CTA.",
      },
    ],
  },
];

/**
 * Merges an inspiration preset into the default weekly queue shape.
 * @param preset Feature-led preset with three slots.
 * @return Queue items ready for the form.
 */
export function applyInspirationPreset(preset: LinkedInOsInspirationPreset): LinkedInOsJobItem[] {
  return DEFAULT_QUEUE_ITEMS.map((base, index) => {
    const slot = preset.slots[index];
    if (!slot) return { ...base };
    return {
      ...base,
      hook: slot.hook,
      productTruth: slot.productTruth,
      notes: slot.notes ?? "",
    };
  });
}
