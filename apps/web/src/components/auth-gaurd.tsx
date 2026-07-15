
"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarProvider } from "@/components/ui/sidebar";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Added /data-deletion to public paths for Facebook compliance
  const publicPaths = ['/login', '/pay/contract', '/share/contract', '/data-deletion', '/sms-opt-in', '/l/', '/overview', '/s/'];
  const onboardingPath = '/onboarding';

  useEffect(() => {
    if (isLoading) return; // Wait for authentication state to be determined

    if (isAuthenticated && user) {
      // If user is authenticated but hasn't completed onboarding, and isn't on the onboarding page
      if (!user.hasCompletedOnboarding && pathname !== onboardingPath) {
        router.replace(onboardingPath);
      }
      // If user is on the login page but is authenticated, redirect them
      if (pathname === '/login') {
          router.replace(user.hasCompletedOnboarding ? '/dashboard' : onboardingPath);
      }

      // If creator has finished onboarding but not career path, force them to dashboard
      const isCreator = user.role === 'individual_creator' || user.role === 'talent';
      if (user.hasCompletedOnboarding && !user.hasCompletedCareerPath && isCreator && pathname !== '/dashboard' && pathname !== onboardingPath) {
        router.replace('/dashboard');
      }

      // If agency owner has finished onboarding but not brand journey, force them to dashboard
      const isAgencyOwner = user.role === 'agency_owner';
      if (user.hasCompletedOnboarding && !user.hasCompletedBrandJourney && isAgencyOwner && pathname !== '/dashboard' && pathname !== onboardingPath) {
        router.replace('/dashboard');
      }
    } else if (!isAuthenticated) {
      // If user is not authenticated and not on a public path, redirect to login
      const isPublicPath = publicPaths.some(p => pathname.startsWith(p));
      if (!isPublicPath && pathname !== onboardingPath) {
        router.replace('/login');
      }
    }
  }, [isAuthenticated, isLoading, user, router, pathname]);

  // Show a loading skeleton while the auth state is being determined
  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  // If user is trying to access a page they shouldn't be on, return null while redirecting.
  if (isAuthenticated && user) {
    if (!user.hasCompletedOnboarding && pathname !== onboardingPath) return null;
    if (user.hasCompletedOnboarding && pathname === onboardingPath) return null;

    const isCreator = user.role === 'individual_creator' || user.role === 'talent';
    if (user.hasCompletedOnboarding && !user.hasCompletedCareerPath && isCreator && pathname !== '/dashboard' && pathname !== onboardingPath) return null;

    const isAgencyOwner = user.role === 'agency_owner';
    if (user.hasCompletedOnboarding && !user.hasCompletedBrandJourney && isAgencyOwner && pathname !== '/dashboard' && pathname !== onboardingPath) return null;
  } else if (!isAuthenticated) {
    const isPublicPath = publicPaths.some(p => pathname.startsWith(p));
      if (!isPublicPath && pathname !== onboardingPath) {
        return null;
      }
  }
  
  // Show layout for authenticated users who have completed onboarding and are on a protected page
  if (isAuthenticated && user?.hasCompletedOnboarding && !publicPaths.some(p => pathname.startsWith(p))) {
    return (
       <SidebarProvider>
        <AppLayout>{children}</AppLayout>
      </SidebarProvider>
    );
  }
  
  // For public pages, the onboarding page, or login page when not authenticated
  return <>{children}</>;
}
