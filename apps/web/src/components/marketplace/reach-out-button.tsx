"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { setPostAuthRedirect } from "@/lib/post-auth-redirect";

export function ReachOutButton({ creatorId }: { creatorId: string }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const returnTo = `/creator/${creatorId}`;
  const isBrand = user?.isBrandAccount || user?.role === "agency_owner" || user?.role === "agency_admin" || user?.role === "agency_member";

  if (isLoading) {
    return (
      <Button className="w-full mt-6" disabled>
        Reach out
      </Button>
    );
  }

  if (!isAuthenticated) {
    return (
      <Button asChild className="w-full mt-6">
        <Link href={`/login?next=${encodeURIComponent(returnTo)}`} onClick={() => setPostAuthRedirect(returnTo)}>
          Sign up to reach out
        </Link>
      </Button>
    );
  }

  if (isBrand) {
    return (
      <Button asChild className="w-full mt-6">
        <Link href="/campaigns">
          <Megaphone className="mr-2 h-4 w-4" />
          Invite to a campaign
        </Link>
      </Button>
    );
  }

  return (
    <p className="mt-6 text-sm text-muted-foreground">
      Brands on Verza can invite this creator to a campaign. Contact stays on Verza — email is not shared.
    </p>
  );
}
