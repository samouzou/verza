import type { PublicCampaign } from '@verza/types';

export const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.tryverza.com').replace(/\/+$/, '');

const REVALIDATE_SECONDS = 300;
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '';

function firestoreBase(): string {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || '8090';
    return `http://127.0.0.1:${port}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  }
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
}

function withKey(url: string): string {
  if (!API_KEY || process.env.NODE_ENV === 'development') return url;
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(API_KEY)}`;
}

type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  stringValue?: string;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

function decodeValue(v: FirestoreValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue?.fields ?? {});
  return null;
}

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

/** Must match `slugifyCampaign` in apps/functions/src/gigs/publicCampaigns.ts. */
export function campaignSlug(title: string, gigId: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-${gigId}` : gigId;
}

/** Firestore auto-ids contain no hyphens, so the id is everything after the last "-". */
export function campaignIdFromSlug(slug: string): string {
  const idx = slug.lastIndexOf('-');
  return idx === -1 ? slug : slug.slice(idx + 1);
}

export function publicCampaignUrl(campaign: Pick<PublicCampaign, 'slug'>): string {
  return `${APP_BASE_URL}/c/${campaign.slug}`;
}

export async function getPublicCampaign(id: string): Promise<PublicCampaign | null> {
  if (!PROJECT_ID || !/^[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const res = await fetch(withKey(`${firestoreBase()}/public_campaigns/${id}`), {
      next: { revalidate: REVALIDATE_SECONDS, tags: [`public-campaign-${id}`] },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: Record<string, FirestoreValue> };
    if (!json.fields) return null;
    return { ...(decodeFields(json.fields) as Omit<PublicCampaign, 'id'>), id } as PublicCampaign;
  } catch {
    return null;
  }
}

export async function listPublicCampaigns(max = 200): Promise<PublicCampaign[]> {
  if (!PROJECT_ID) return [];
  try {
    const res = await fetch(withKey(`${firestoreBase()}:runQuery`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'public_campaigns' }],
          where: {
            fieldFilter: { field: { fieldPath: 'listed' }, op: 'EQUAL', value: { booleanValue: true } },
          },
          limit: max,
        },
      }),
      next: { revalidate: REVALIDATE_SECONDS, tags: ['public-campaigns'] },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FirestoreValue> } }>;
    return rows
      .filter((r) => r.document?.fields)
      .map((r) => {
        const id = r.document!.name.split('/').pop()!;
        return { ...(decodeFields(r.document!.fields!) as Omit<PublicCampaign, 'id'>), id } as PublicCampaign;
      })
      .sort((a, b) => (b.createdAtIso ?? '').localeCompare(a.createdAtIso ?? ''));
  } catch {
    return [];
  }
}

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  standard_sponsorship: 'Sponsored content',
  production_grant: 'Production grant',
  cause_campaign: 'Cause campaign',
  barter_campaign: 'Product exchange',
};

const USAGE_RIGHTS_LABELS: Record<string, string> = {
  none: 'No usage rights',
  '30_days': '30 days',
  '1_year': '1 year',
  perpetuity: 'In perpetuity',
};

export function usageRightsLabel(value: string | null | undefined): string | null {
  return value ? USAGE_RIGHTS_LABELS[value] ?? value : null;
}

export function campaignTypeLabel(type: string): string {
  return CAMPAIGN_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** One-line compensation summary, e.g. "$250 per creator + $5 per sale". */
export function compensationSummary(c: PublicCampaign): string {
  const parts: string[] = [];
  if (c.ratePerCreator > 0) parts.push(`${formatUsd(c.ratePerCreator)} per creator`);
  if (c.performanceReward && c.performanceReward.rewardAmount > 0) {
    const unit = c.performanceReward.rewardType === 'cpc' ? 'click' : 'sale';
    parts.push(`${formatUsd(c.performanceReward.rewardAmount)} per ${unit}`);
  }
  if (parts.length === 0) return c.campaignType === 'barter_campaign' ? 'Product exchange' : 'See details';
  return parts.join(' + ');
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text from a brief that may be HTML, markdown-ish, or plain. */
export function plainText(text: string): string {
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return HTML_ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[#*_`>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function plainExcerpt(text: string, max = 160): string {
  const clean = plainText(text);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
