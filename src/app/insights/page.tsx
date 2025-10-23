
"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Instagram, Youtube, Link as LinkIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";

// Placeholder for TikTok Icon
const TikTokIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-2.43.05-4.86-.45-6.6-1.8-1.49-1.15-2.55-2.88-2.9-4.75-.24-1.25-.3-2.5-.3-3.75.02-3.48-.02-6.96.02-10.43.01-1.49.53-2.96 1.5-4.04 1.04-1.14 2.56-1.74 4.13-1.82.08-.01.15-.01.23-.01.02.52.01 1.05-.01 1.57-.21.53-.41 1.07-.63 1.6-.22.53-.46 1.05-.69 1.58-.04.1-.06.21-.07.32.02.05.04.09.06.13.25.5.53.98.83 1.44.31.47.65.92 1 1.35.02.02.04.04.05.06.02.04.02.09.01.14-.24 1.52-.52 3.03-.78 4.55-.01.05-.02.11-.02.16-.21-.05-.42-.09-.63-.15-.53-.15-1.07-.26-1.6-.42-.53-.16-1.07-.28-1.6-.45-.29-.09-.58-.15-.88-.23-.02-3.13.01-6.27-.02-9.4.04-.52.12-1.03.23-1.54.11-.5.25-1 .41-1.48.11-.33.24-.65.38-.97.16-.35.34-.69.54-1.03.02-.04.05-.07.08-.1.02.01.05.01.07.02z"/>
    </svg>
);

export default function InsightsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnectInstagram = async () => {
    setIsConnecting(true);
    toast({ title: 'Redirecting to Instagram...', description: 'Please follow the prompts to authorize Verza.' });
    try {
      const getInstagramAuthUrl = httpsCallable(functions, 'getInstagramAuthUrl');
      const result = await getInstagramAuthUrl();
      const { authUrl } = result.data as { authUrl: string };

      if (authUrl) {
        window.location.href = authUrl;
      } else {
        throw new Error("Could not retrieve Instagram authorization URL.");
      }
    } catch (error: any) {
      console.error("Error initiating Instagram connection:", error);
      toast({
        title: "Connection Failed",
        description: error.message || "Could not connect to Instagram. Please try again.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };


  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Please log in to access Creator Insights.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Creator Insights"
        description="Connect your social media accounts to analyze your audience and estimate your earnings potential."
      />
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Connect Your Accounts</CardTitle>
            <CardDescription>
              Link your social platforms to begin importing your engagement data. Verza uses read-only access and will never post on your behalf.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Button variant="outline" size="lg" className="justify-start gap-3 p-6 text-lg" onClick={handleConnectInstagram} disabled={isConnecting}>
                {isConnecting ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Instagram className="h-6 w-6 text-pink-500" />
                )}
                Connect Instagram
            </Button>
            <Button variant="outline" size="lg" className="justify-start gap-3 p-6 text-lg" disabled>
                <TikTokIcon />
                Connect TikTok
            </Button>
            <Button variant="outline" size="lg" className="justify-start gap-3 p-6 text-lg" disabled>
                <Youtube className="h-6 w-6 text-red-500" />
                Connect YouTube
            </Button>
          </CardContent>
        </Card>
        
        <Card className="bg-muted/50">
            <CardHeader>
                <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
                <p>1. Connect your social media accounts using the buttons above.</p>
                <p>2. Verza will securely fetch your public engagement data, like follower counts, views, and likes.</p>
                <p>3. Use the dashboard to view trends, understand your audience, and get AI-powered estimates for brand deals.</p>
            </CardContent>
        </Card>
      </div>
    </>
  );
}
