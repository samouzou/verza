import type { PublicCreator } from '@verza/types';
import { APP_BASE_URL, getPublicFirestoreDoc } from '@/lib/public-campaigns';

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

export function publicCreatorUrl(id: string): string {
  return `${APP_BASE_URL}/creator/${id}`;
}

export async function getPublicCreator(id: string): Promise<PublicCreator | null> {
  return getPublicFirestoreDoc<PublicCreator>(
    'public_creators',
    id,
    /^[A-Za-z0-9_-]{8,128}$/,
    `public-creator-${id}`,
  );
}

export async function listPublicCreators(max = 1000): Promise<PublicCreator[]> {
  if (!PROJECT_ID) return [];
  try {
    const res = await fetch(withKey(`${firestoreBase()}:runQuery`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'public_creators' }],
          limit: max,
        },
      }),
      next: { revalidate: REVALIDATE_SECONDS, tags: ['public-creators'] },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FirestoreValue> } }>;
    return rows
      .filter((r) => r.document?.fields)
      .map((r) => {
        const id = r.document!.name.split('/').pop()!;
        return { ...(decodeFields(r.document!.fields!) as Omit<PublicCreator, 'id'>), id } as PublicCreator;
      });
  } catch {
    return [];
  }
}
