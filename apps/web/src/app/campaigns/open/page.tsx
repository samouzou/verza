import type { Metadata } from 'next';
import { PublicShell } from '@/components/public-campaigns/public-shell';
import { PublicCampaignCard } from '@/components/public-campaigns/campaign-card';
import { APP_BASE_URL, listPublicCampaigns } from '@/lib/public-campaigns';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Paid creator campaigns open now | Verza',
  description:
    'Browse paid brand campaigns for TikTok, Instagram, and YouTube creators. See the brief and pay up front, then apply for free on Verza.',
  alternates: { canonical: `${APP_BASE_URL}/campaigns/open` },
  openGraph: {
    type: 'website',
    url: `${APP_BASE_URL}/campaigns/open`,
    title: 'Paid creator campaigns open now',
    description: 'Real brands, pre-funded pay, free to apply.',
    siteName: 'Verza',
  },
};

export default async function OpenCampaignsPage() {
  const campaigns = await listPublicCampaigns();

  return (
    <PublicShell>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold sm:text-4xl">Paid creator campaigns, open now</h1>
        <p className="mt-3 text-muted-foreground">
          Brands on Verza fund campaigns before creators start. Read the brief, see the pay, and apply for free.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <div className="mt-10 rounded-xl border bg-background p-10 text-center text-muted-foreground">
          No open campaigns right now. Check back soon.
        </div>
      ) : (
        <>
          <p className="mt-8 text-sm text-muted-foreground">
            {campaigns.length} open campaign{campaigns.length === 1 ? '' : 's'}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {campaigns.map((c) => (
              <PublicCampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        </>
      )}
    </PublicShell>
  );
}
