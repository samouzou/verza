import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { CalendarDays, CheckCircle2, Clapperboard, Lock, Megaphone, MessageSquare, Package, Palette, ShieldCheck, Users, Zap } from 'lucide-react';
import type { PublicCampaign } from '@verza/types';
import { PublicShell } from '@/components/public-campaigns/public-shell';
import { PublicApplyButton } from '@/components/public-campaigns/apply-button';
import { BrandMark } from '@/components/public-campaigns/campaign-card';
import {
  campaignIdFromSlug,
  campaignTypeLabel,
  compensationSummary,
  formatUsd,
  getPublicCampaign,
  plainExcerpt,
  publicCampaignUrl,
  usageRightsLabel,
} from '@/lib/public-campaigns';
import { sanitizeCampaignHtml } from '@/lib/sanitize-campaign-html';

export const revalidate = 300;

type PageProps = { params: Promise<{ slug: string }> };

async function loadCampaign(slug: string): Promise<PublicCampaign | null> {
  return getPublicCampaign(campaignIdFromSlug(slug));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await loadCampaign(slug);
  if (!campaign) return { title: 'Campaign not found · Verza', robots: { index: false } };

  const title = `${campaign.title} · ${campaign.brandName} creator campaign`;
  const description = plainExcerpt(
    `${compensationSummary(campaign)}. ${campaign.platforms.join(', ')}. ${campaign.description}`,
    160,
  );
  const url = publicCampaignUrl(campaign);
  return {
    title: `${title} | Verza`,
    description,
    alternates: { canonical: url },
    robots: campaign.listed ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      siteName: 'Verza',
      ...(campaign.brandLogoUrl ? { images: [{ url: campaign.brandLogoUrl, alt: campaign.brandName }] } : {}),
    },
    twitter: { card: 'summary', title, description },
  };
}

function jobPostingJsonLd(c: PublicCampaign) {
  const validThrough = c.deliverablesDueDate && new Date(c.deliverablesDueDate) > new Date() ? c.deliverablesDueDate : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: `${c.title} (${c.brandName} creator campaign)`,
    description: sanitizeCampaignHtml(c.description),
    datePosted: c.createdAtIso ?? c.updatedAtIso,
    ...(validThrough ? { validThrough } : {}),
    employmentType: 'CONTRACTOR',
    jobLocationType: 'TELECOMMUTE',
    directApply: true,
    url: publicCampaignUrl(c),
    hiringOrganization: {
      '@type': 'Organization',
      name: c.brandName,
      ...(c.brandLogoUrl ? { logo: c.brandLogoUrl } : {}),
    },
    ...(c.ratePerCreator > 0
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: 'USD',
            value: { '@type': 'QuantitativeValue', value: c.ratePerCreator, unitText: 'PROJECT' },
          },
        }
      : {}),
  };
}

function Fact({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export default async function PublicCampaignPage({ params }: PageProps) {
  const { slug } = await params;
  const campaign = await loadCampaign(slug);
  if (!campaign) notFound();
  if (campaign.slug !== slug) permanentRedirect(`/c/${campaign.slug}`);

  const isOpen = campaign.listed && campaign.status === 'open';
  const isCause = campaign.campaignType === 'cause_campaign';
  const full = !isCause && campaign.creatorsNeeded > 0 && campaign.spotsLeft === 0;
  const canApply = isOpen && !full;
  const usage = usageRightsLabel(campaign.usageRights);
  const briefHtml = sanitizeCampaignHtml(campaign.description);
  const dueDate = campaign.deliverablesDueDate
    ? new Date(campaign.deliverablesDueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <PublicShell>
      {campaign.listed && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd(campaign)).replace(/</g, '\\u003c') }}
        />
      )}

      <Link href="/campaigns/open" className="text-sm text-muted-foreground hover:text-foreground">
        ← All open campaigns
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0 rounded-xl border bg-background p-4 shadow-sm sm:p-8">
          <div className="flex items-center gap-4">
            <BrandMark campaign={campaign} size={56} />
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{campaign.brandName}</p>
              <h1 className="break-words text-xl font-bold leading-tight sm:text-3xl">{campaign.title}</h1>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1">{campaignTypeLabel(campaign.campaignType)}</span>
            {campaign.platforms.map((p) => (
              <span key={p} className="rounded-full bg-muted px-2.5 py-1">{p}</span>
            ))}
            {!isOpen && (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-700">
                No longer accepting applications
              </span>
            )}
          </div>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">The brief</h2>
          <div
            className="prose prose-slate mt-3 max-w-none break-words text-foreground prose-headings:font-semibold prose-a:text-primary prose-p:leading-relaxed prose-li:my-1 sm:prose-base"
            dangerouslySetInnerHTML={{ __html: briefHtml }}
          />

          {campaign.hasBrandKit && (
            <section className="mt-8 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background">
                  <Lock className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold">Brand Identity Kit</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Unlocks when {campaign.brandName} accepts you. Everything you need to film on-brand:
                  </p>
                  <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-3">
                    <li className="flex items-center gap-2"><Palette className="h-4 w-4 shrink-0 text-primary" /> Visual identity</li>
                    <li className="flex items-center gap-2"><MessageSquare className="h-4 w-4 shrink-0 text-primary" /> Voice guidelines</li>
                    <li className="flex items-center gap-2"><Package className="h-4 w-4 shrink-0 text-primary" /> Product lookbook</li>
                  </ul>
                  {canApply && (
                    <PublicApplyButton
                      campaignId={campaign.id}
                      label="Apply to unlock"
                      className="mt-4 h-9 px-4 text-xs"
                    />
                  )}
                </div>
              </div>
            </section>
          )}

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">How it works</h2>
          <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Apply with your Verza creator profile. It&apos;s free.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {campaign.brandName} reviews applicants and accepts the best fits.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Post your content, submit it in Verza, and get paid once it&apos;s approved.</li>
          </ol>
        </article>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border bg-background p-5 shadow-sm">
            <p className="text-xs text-muted-foreground">Compensation</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{compensationSummary(campaign)}</p>
            {campaign.performanceReward && campaign.performanceReward.rewardAmount > 0 && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" /> Performance pay tracked automatically
                {campaign.performanceReward.trackingMethod === 'promo_code_only' ? ' by promo code' : ' by link'}.
              </p>
            )}

            <div className="mt-5 space-y-4">
              {!isCause && campaign.creatorsNeeded > 0 && (
                <Fact icon={Users} label="Spots" value={`${campaign.spotsLeft} of ${campaign.creatorsNeeded} left`} />
              )}
              {campaign.videosPerCreator > 0 && (
                <Fact icon={Clapperboard} label="Deliverables" value={`${campaign.videosPerCreator} video${campaign.videosPerCreator === 1 ? '' : 's'} per creator`} />
              )}
              {dueDate && <Fact icon={CalendarDays} label="Content due" value={dueDate} />}
              {usage && <Fact icon={ShieldCheck} label="Usage rights" value={usage} />}
              {campaign.allowWhitelisting && <Fact icon={Megaphone} label="Paid ads" value="Brand may run your post as an ad" />}
              {campaign.requireVerzaScore && campaign.verzaScoreThreshold != null && (
                <Fact icon={CheckCircle2} label="Quality bar" value={`Verza Score ${campaign.verzaScoreThreshold}+`} />
              )}
              {campaign.budgetMode === 'pool' && (
                <p className="text-xs text-muted-foreground">
                  A flat fee is set when the brand accepts you. You receive that amount in full. Verza&apos;s fee is paid by the brand.
                </p>
              )}
              {campaign.budgetMode !== 'pool' && campaign.ratePerCreator > 0 && (
                <p className="text-xs text-muted-foreground">
                  Base pay is pre-funded by the brand. You receive about {formatUsd(campaign.ratePerCreator * 0.85)} after Verza&apos;s 15% fee.
                </p>
              )}
            </div>

            <div className="mt-6">
              {canApply ? (
                <>
                  <PublicApplyButton campaignId={campaign.id} label={isCause ? 'Claim this campaign' : 'Apply to this campaign'} className="w-full" />
                  <p className="mt-2 text-center text-xs text-muted-foreground">Free to apply. You&apos;ll sign in or create an account first.</p>
                </>
              ) : (
                <>
                  <div className="rounded-md bg-muted px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    {full ? 'All spots are filled' : 'This campaign is closed'}
                  </div>
                  <Link href="/campaigns/open" className="mt-3 block text-center text-sm font-medium text-primary hover:underline">
                    Browse open campaigns
                  </Link>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </PublicShell>
  );
}
