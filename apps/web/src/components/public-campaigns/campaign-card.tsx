import Link from 'next/link';
import type { PublicCampaign } from '@verza/types';
import { campaignTypeLabel, compensationSummary, plainExcerpt } from '@/lib/public-campaigns';

export function BrandMark({ campaign, size = 44 }: { campaign: Pick<PublicCampaign, 'brandName' | 'brandLogoUrl'>; size?: number }) {
  if (campaign.brandLogoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={campaign.brandLogoUrl}
        alt={`${campaign.brandName} logo`}
        width={size}
        height={size}
        className="shrink-0 rounded-lg border bg-white object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
      style={{ width: size, height: size }}
    >
      {campaign.brandName.charAt(0).toUpperCase()}
    </div>
  );
}

export function PublicCampaignCard({ campaign }: { campaign: PublicCampaign }) {
  const showSpots = campaign.campaignType !== 'cause_campaign' && campaign.creatorsNeeded > 0;
  return (
    <Link
      href={`/c/${campaign.slug}`}
      className="group flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md sm:gap-4 sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <BrandMark campaign={campaign} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{campaign.brandName}</p>
          <h2 className="line-clamp-2 break-words font-semibold leading-snug group-hover:text-primary">{campaign.title}</h2>
        </div>
      </div>
      <p className="line-clamp-3 break-words text-sm text-muted-foreground">{plainExcerpt(campaign.description, 220)}</p>
      <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5 text-xs sm:gap-2">
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-700">
          {compensationSummary(campaign)}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1">{campaignTypeLabel(campaign.campaignType)}</span>
        {campaign.platforms.slice(0, 3).map((p) => (
          <span key={p} className="rounded-full bg-muted px-2.5 py-1">{p}</span>
        ))}
        {showSpots && (
          <span className="w-full text-muted-foreground sm:ml-auto sm:w-auto">
            {campaign.spotsLeft} of {campaign.creatorsNeeded} spots left
          </span>
        )}
      </div>
    </Link>
  );
}
