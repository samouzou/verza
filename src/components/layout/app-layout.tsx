
"use client";

import type { ReactNode } from "react";
import * as React from "react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"; // Import SidebarTrigger
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MailWarning, Send } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, resendVerificationEmail, isLoading: authIsLoading } = useAuth();
  const [isResendingEmail, setIsResendingEmail] = React.useState(false);

  const handleResendEmail = async () => {
    setIsResendingEmail(true);
    await resendVerificationEmail();
    setIsResendingEmail(false);
  };

  const showVerificationBanner = user && !user.emailVerified && !authIsLoading;

  return (
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* SidebarNav will be handled by SidebarProvider: 
            - Renders as fixed/collapsible on desktop.
            - Its content is used for the Sheet on mobile.
        */}
        <SidebarNav />
        
        {/* Main content area wrapper for mobile header and actual content */}
        <div className="flex flex-1 flex-col">
          {/* Mobile-only Header with Trigger */}
          <div className="app-layout-header-global flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
            <div className="flex items-center">
              <SidebarTrigger className="mr-2 h-7 w-7" /> {/* Trigger to open mobile Sheet */}
              <div className="flex items-center gap-2">
                <svg width="32" height="32" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
                  <text x="5" y="38" fontFamily="Space Grotesk, sans-serif" fontSize="42" fontWeight="bold" fill="currentColor">V</text>
                </svg>
                <span className="font-semibold text-lg">Verza</span>
              </div>
            </div>
            {/* You can add other mobile-specific header items here, like a ThemeToggle */}
          </div>

          {/* Main scrollable content area */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            {showVerificationBanner && (
              <Alert variant="default" className="mb-6 border-yellow-500/50 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700/50 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400">
                <MailWarning className="h-5 w-5" />
                <AlertTitle className="font-semibold">Verify Your Email Address</AlertTitle>
                <AlertDescription>
                  A verification link has been sent to your email ({user.email}). Please check your inbox (and spam folder) to complete your account setup.
                </AlertDescription>
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResendEmail}
                    disabled={isResendingEmail}
                    className="border-yellow-600/50 text-yellow-700 hover:bg-yellow-100 dark:border-yellow-500/50 dark:text-yellow-300 dark:hover:bg-yellow-800/30"
                  >
                    {isResendingEmail ? "Sending..." : <><Send className="mr-2 h-4 w-4" /> Resend Email</>}
                  </Button>
                </div>
              </Alert>
            )}
            {children}
          </main>
        </div>
      </div>
  );
}
