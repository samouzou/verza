import type { MetadataRoute } from 'next';
import { APP_BASE_URL, listPublicCampaigns, publicCampaignUrl } from '@/lib/public-campaigns';
import { listPublicCreators, publicCreatorUrl } from '@/lib/public-creators';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [campaigns, creators] = await Promise.all([listPublicCampaigns(1000), listPublicCreators(1000)]);
  return [
    {
      url: `${APP_BASE_URL}/campaigns/open`,
      changeFrequency: 'hourly',
      priority: 0.8,
    },
    ...campaigns.map((c) => ({
      url: publicCampaignUrl(c),
      lastModified: c.updatedAtIso,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
    ...creators.map((creator) => ({
      url: publicCreatorUrl(creator.id),
      lastModified: creator.updatedAtIso,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
  ];
}
