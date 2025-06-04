
"use client";

import { useAuth } from "@/hooks/use-auth"; // Updated import
import { useRouter, usePathname } from "next/navigation";
import type { ReactNode} from 'react';
import { useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Skeleton } from "@/components/ui/skeleton"; 

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth(); // Updated hook usage
  const router = useRouter();
  const pathname = usePathname();

  const publicPaths = ['/login', '/pay/contract']; // Add the base path for client payment

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !publicPaths.some(path => pathname.startsWith(path))) {
      router.push("/login");
    }
  }, [isAuthenticated, isLoading, router, pathname]);

  // If on a public path, always render it.
  // LoginPage itself will handle redirection if the user becomes authenticated.
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return <>{children}</>;
  }

  // For all other pages:
  if (isLoading) {
    // Show a loading skeleton during initial auth check or transitions.
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </div>
      </div>
    );
  }

  // If not loading, not on login page, and authenticated, show the app layout.
  if (isAuthenticated) {
    return <AppLayout>{children}</AppLayout>;
  }
  
  // If not loading, not on login page, and not authenticated,
  // the useEffect above should have already initiated a redirect to /login.
  // Returning null here prevents rendering anything further during the redirect.
  return null;
}
