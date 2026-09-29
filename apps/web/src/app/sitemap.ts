import type { MetadataRoute } from 'next';
import { APP_BASE_URL, listPublicCampaigns, publicCampaignUrl } from '@/lib/public-campaigns';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const campaigns = await listPublicCampaigns(1000);
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
  ];
}
