'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { setPostAuthRedirect } from '@/lib/post-auth-redirect';
import { cn } from '@/lib/utils';

export function PublicApplyButton({
  campaignId,
  label = 'Apply to this campaign',
  className,
}: {
  campaignId: string;
  label?: string;
  className?: string;
}) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const target = `/campaigns/${campaignId}?apply=1`;
  const loginHref = `/login?next=${encodeURIComponent(target)}`;

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setPostAuthRedirect(target);
    router.push(isAuthenticated ? target : loginHref);
  };

  return (
    <Link
      href={loginHref}
      onClick={onClick}
      rel="nofollow"
      className={cn(
        'inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90',
        className,
      )}
    >
      {label}
    </Link>
  );
}
