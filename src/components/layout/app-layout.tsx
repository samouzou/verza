
"use client";

import type { ReactNode } from "react";
import * as React from "react"; // Added import for React
import { SidebarProvider } from "@/components/ui/sidebar";
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
    <SidebarProvider>
      <div className="flex min-h-screen">
        <SidebarNav />
        <main className="flex-1 overflow-x-hidden bg-secondary/50 p-4 md:p-6 lg:p-8">
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
                  {isResendingEmail ? "Sending..." : <><Send className="mr-2 h-4 w-4" /> Resend Verification Email</>}
                </Button>
              </div>
            </Alert>
          )}
          {/* Removed mx-auto and max-w-7xl to make content area full width */}
          <div className=""> 
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
