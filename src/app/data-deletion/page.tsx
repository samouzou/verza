
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldAlert, Trash2, Mail } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

/**
 * @fileOverview Facebook Data Deletion Instructions page.
 * Required for Meta App compliance.
 */

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Image src="/verza-icon.svg" alt="Verza Icon" width={40} height={40} />
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Data Deletion Instructions</h1>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-primary" />
              Your Privacy Matters
            </CardTitle>
            <CardDescription>
              At Verza, we respect your data privacy and provide simple ways to manage or remove your information.
            </CardDescription>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-6">
            <section>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                How to Delete Your Data
              </h3>
              <p>
                You can delete your Verza account and all associated data (including information synced from Facebook/Instagram) at any time through the following steps:
              </p>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Log in to your Verza account.</li>
                <li>Navigate to your <strong>Profile</strong> settings page.</li>
                <li>Scroll down to the <strong>Danger Zone</strong> section.</li>
                <li>Click on <strong>Delete My Account</strong> and confirm your choice.</li>
              </ol>
              <div className="mt-4">
                <Button asChild variant="outline">
                  <Link href="/profile">Go to Profile Settings</Link>
                </Button>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Manual Request
              </h3>
              <p>
                If you are unable to log in or wish to submit a manual deletion request, please email our support team at:
              </p>
              <p className="font-mono bg-muted p-2 rounded inline-block">
                support@tryverza.com
              </p>
              <p>
                Please include your account email address and a clear request to delete your data. We will process your request within 30 days.
              </p>
            </section>

            <section>
              <h3 className="text-lg font-semibold">What data is deleted?</h3>
              <p>
                When you delete your account, we permanently remove:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Your profile information (name, email, avatar).</li>
                <li>Any synced social media statistics (follower counts, engagement rates).</li>
                <li>Your contract history and uploaded documents.</li>
                <li>Financial records and linked bank information.</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4 italic">
                Note: Some transactional data required for legal or tax compliance (e.g., payment history) may be retained for the minimum period required by law.
              </p>
            </section>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Button variant="ghost" asChild>
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
