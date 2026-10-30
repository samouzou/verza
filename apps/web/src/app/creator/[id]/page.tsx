import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BadgeCheck, CheckCircle2, Flame, Instagram, Sparkles, Star, Trophy, Youtube, ExternalLink } from 'lucide-react';
import type { ContentShowcaseItem, PublicCreator } from '@verza/types';

import { ReachOutButton } from '@/components/marketplace/reach-out-button';
import { PublicShell } from '@/components/public-campaigns/public-shell';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { extractYouTubeVideoId, isYouTubeUrl } from '@/lib/youtube';
import { APP_BASE_URL } from '@/lib/public-campaigns';
import { getPublicCreator, publicCreatorUrl } from '@/lib/public-creators';
import { cn } from '@/lib/utils';

export const revalidate = 300;

type PageProps = { params: Promise<{ id: string }> };

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M19.589 6.686a4.793 4.83 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743 2.897 2.897 0 0 1 3.103-4.532V9.424a7.274 7.274 0 0 0-7.274 7.243 7.274 7.274 0 0 0 14.548 0V8.308a8.294 8.294 0 0 0 5.33 3.442V8.308a4.83 4.83 0 0 1-3.291-1.622z" />
  </svg>
);

const PLATFORM_LABEL: Record<ContentShowcaseItem['platform'], string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

function formatFollowers(num: number) {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${Math.floor(num / 1000)}K`;
  return num.toString();
}

function ShowcaseTile({ item }: { item: ContentShowcaseItem }) {
  const youtubeId = item.platform === 'youtube' && isYouTubeUrl(item.url) ? extractYouTubeVideoId(item.url) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-muted">
      <div className="relative aspect-video bg-black">
        {youtubeId ? (
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${youtubeId}`}
            title="YouTube showcase"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground transition-colors hover:bg-muted/80 hover:text-primary"
          >
            {item.platform === 'instagram' ? (
              <Instagram className="h-6 w-6 text-pink-500" />
            ) : item.platform === 'youtube' ? (
              <Youtube className="h-6 w-6 text-red-500" />
            ) : (
              <TikTokIcon className="h-6 w-6" />
            )}
            <span className="text-xs font-medium">Watch on {PLATFORM_LABEL[item.platform]}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {item.verzaScore != null && item.verzaScore > 0 && (
          <Badge className="absolute top-2 right-2 gap-1 text-[10px]">
            <Flame className="h-2.5 w-2.5 fill-current" />
            {item.verzaScore}%
          </Badge>
        )}
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const creator = await getPublicCreator(id);
  if (!creator) return { title: 'Creator not found · Verza', robots: { index: false } };

  const title = `${creator.displayName} · ${creator.niche}`;
  const description = creator.missionStatement?.trim() ||
    `${creator.displayName} is a ${creator.niche} creator on Verza.`;
  const url = publicCreatorUrl(creator.id);
  return {
    title: `${title} | Verza`,
    description: description.slice(0, 160),
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'profile',
      url,
      title,
      description: description.slice(0, 160),
      siteName: 'Verza',
      ...(creator.avatarUrl ? { images: [{ url: creator.avatarUrl, alt: creator.displayName }] } : {}),
    },
    twitter: { card: 'summary', title, description: description.slice(0, 160) },
  };
}

function personJsonLd(creator: PublicCreator) {
  const sameAs = [creator.instagramUrl, creator.tiktokUrl, creator.youtubeUrl].filter(
    (href): href is string => typeof href === 'string' && href.length > 0
  );
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: creator.displayName,
    url: publicCreatorUrl(creator.id),
    description: creator.missionStatement || creator.niche,
    ...(creator.avatarUrl ? { image: creator.avatarUrl } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    worksFor: { '@type': 'Organization', name: 'Verza', url: APP_BASE_URL },
  };
}

export default async function CreatorProfilePage({ params }: PageProps) {
  const { id } = await params;
  const creator = await getPublicCreator(id);
  if (!creator) notFound();

  const isVerified = creator.instagramConnected || creator.tiktokConnected || creator.youtubeConnected;
  const platforms = [
    {
      id: 'Instagram',
      connected: creator.instagramConnected,
      followers: creator.instagramFollowers,
      engagement: creator.instagramEngagement,
      href: creator.instagramUrl,
      icon: Instagram,
      color: 'text-pink-500',
      metricLabel: 'Followers',
    },
    {
      id: 'TikTok',
      connected: creator.tiktokConnected,
      followers: creator.tiktokFollowers,
      engagement: creator.tiktokEngagement,
      href: creator.tiktokUrl,
      icon: TikTokIcon,
      color: 'text-foreground',
      metricLabel: 'Followers',
    },
    {
      id: 'YouTube',
      connected: creator.youtubeConnected,
      followers: creator.youtubeFollowers,
      engagement: creator.youtubeEngagement,
      href: creator.youtubeUrl,
      icon: Youtube,
      color: 'text-red-500',
      metricLabel: 'Subscribers',
    },
  ].filter((p) => p.connected);

  const hasVerzaScore = creator.averageVerzaScore > 0;
  const showcase = creator.contentShowcase ?? [];

  return (
    <PublicShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd(creator)) }}
      />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <div className="space-y-6 md:col-span-1">
          <Card className="overflow-hidden border-primary/10">
            <CardContent className="flex flex-col items-center p-6 text-center">
              <Avatar className="relative mb-4 h-32 w-32 border-4 border-primary/20">
                <AvatarImage src={creator.avatarUrl || ''} alt={creator.displayName} />
                <AvatarFallback className="text-4xl">{creator.displayName.charAt(0) || 'C'}</AvatarFallback>
                {isVerified && (
                  <div className="absolute bottom-0 right-0 rounded-full border-4 border-background bg-primary p-1.5 text-white">
                    <BadgeCheck className="h-5 w-5" />
                  </div>
                )}
              </Avatar>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{creator.displayName}</h1>
                {isVerified && <BadgeCheck className="h-5 w-5 text-primary" />}
              </div>
              <Badge variant="outline" className="mt-2 font-normal text-muted-foreground">
                {creator.contentType || 'General'}
              </Badge>

              <div className="mt-6 w-full space-y-4 border-t pt-6">
                <h2 className="flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> Verified Platforms
                </h2>
                {platforms.length > 0 ? (
                  <div className="space-y-3">
                    {platforms.map((p) => {
                      const row = (
                        <>
                          <div className="flex items-center gap-2">
                            <p.icon className={`h-5 w-5 ${p.color}`} />
                            <span className="text-sm font-bold">{p.id}</span>
                            {p.href && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-sm font-bold">{formatFollowers(p.followers || 0)}</p>
                              <p className="text-[10px] uppercase text-muted-foreground">{p.metricLabel}</p>
                            </div>
                            <div className="border-l pl-4 text-right">
                              <p className="text-sm font-bold">{p.engagement?.toFixed(1) || '0'}%</p>
                              <p className="text-[10px] uppercase text-muted-foreground">Eng.</p>
                            </div>
                          </div>
                        </>
                      );
                      const className =
                        'flex items-center justify-between rounded-lg border bg-muted/50 p-3';
                      return p.href ? (
                        <a
                          key={p.id}
                          href={p.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${className} transition-colors hover:border-primary/40 hover:bg-muted`}
                        >
                          {row}
                        </a>
                      ) : (
                        <div key={p.id} className={className}>
                          {row}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No verified accounts connected.</p>
                )}
              </div>

              <ReachOutButton creatorId={creator.id} />
            </CardContent>
          </Card>

          {(creator.brandWishlist?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Star className="h-4 w-4" /> Target Collaborations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {creator.brandWishlist.map((brand, i) => (
                    <Badge key={`${brand}-${i}`} variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">
                      {brand}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6 md:col-span-2">
          <div className={cn('grid gap-6', hasVerzaScore ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
            {hasVerzaScore && (
              <Card className="border-orange-500/20 bg-gradient-to-br from-orange-500/10 to-transparent">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                    <Flame className="h-4 w-4 fill-orange-500 text-orange-500" /> Avg. Verza Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <p className="text-4xl font-black text-orange-600">{creator.averageVerzaScore}%</p>
                    <p className="text-xs text-muted-foreground">Attention Retention</p>
                  </div>
                  <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
                    Average of scored campaign submissions on Verza.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="border-primary/20 bg-gradient-to-br from-primary/10 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  <Trophy className="h-4 w-4 text-primary" /> Verified Reach
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <p className="text-4xl font-black text-primary">
                    {formatFollowers(
                      (creator.instagramFollowers || 0) +
                        (creator.tiktokFollowers || 0) +
                        (creator.youtubeFollowers || 0)
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">Total Audience</p>
                </div>
                <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
                  Combined following across all connected and verified social platforms.
                </p>
              </CardContent>
            </Card>
          </div>

          {(creator.missionStatement || creator.niche) && (
            <Card className="border-primary/10 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="h-5 w-5 text-primary" /> Creator Mission
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {creator.missionStatement && (
                  <p className="text-xl font-medium italic text-primary/80">&ldquo;{creator.missionStatement}&rdquo;</p>
                )}
                {creator.niche && (
                  <div className="border-t border-primary/10 pt-2">
                    <p className="text-sm text-muted-foreground">{creator.niche}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Content Showcase</CardTitle>
              <CardDescription>Public work this creator has delivered on Verza.</CardDescription>
            </CardHeader>
            <CardContent>
              {showcase.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {showcase.map((item) => (
                    <ShowcaseTile key={item.submissionId} item={item} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This creator has no public Verza work yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
