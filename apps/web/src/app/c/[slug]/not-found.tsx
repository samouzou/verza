import Link from 'next/link';
import { PublicShell } from '@/components/public-campaigns/public-shell';

export default function CampaignNotFound() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">This campaign isn&apos;t available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The brand may have closed it or made it private.
        </p>
        <Link href="/campaigns/open" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Browse open campaigns
        </Link>
      </div>
    </PublicShell>
  );
}
