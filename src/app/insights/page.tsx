
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Instagram, Youtube, Sparkles, LifeBuoy, Lightbulb, Star, Award } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTour } from "@/hooks/use-tour";
import { insightsTour } from "@/lib/tours";
import { Textarea } from '@/components/ui/textarea';
import { analyzeCreatorProfile, type CreatorAnalysisOutput } from '@/ai/flows/creator-analysis-flow';

declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

// Placeholder for TikTok Icon
const TikTokIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-2.43.05-4.86-.45-6.6-1.8-1.49-1.15-2.55-2.88-2.9-4.75-.24-1.25-.3-2.5-.3-3.75.02-3.48-.02-6.96.02-10.43.01-1.49.53-2.96 1.5-4.04 1.04-1.14 2.56-1.74 4.13-1.82.08-.01.15-.01.23-.01.02.52.01 1.05-.01 1.57-.21.53-.41 1.07-.63 1.6-.22.53-.46 1.05-.69 1.58-.04.1-.06.21-.07.32.02.05.04.09.06.13.25.5.53.98.83 1.44.31.47.65.92 1 1.35.02.02.04.04.05.06.02.04.02.09.01.14-.24 1.52-.52 3.03-.78 4.55-.01.05-.02.11-.02.16-.21-.05-.42-.09-.63-.15-.53-.15-1.07-.26-1.6-.42-.53-.16-1.07-.28-1.6-.45-.29-.09-.58-.15-.88-.23-.02-3.13.01-6.27-.02-9.4.04-.52.12-1.03.23-1.54.11-.5.25-1 .41-1.48.11-.33.24-.65.38-.97.16-.35.34-.69.54-1.03.02-.04.05-.07.08-.1.02.01.05.01.07.02z"/>
    </svg>
);

export default function InsightsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { startTour } = useTour();
  
  const [instagramAccessToken, setInstagramAccessToken] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [profileContent, setProfileContent] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CreatorAnalysisOutput | null>(null);

  const handleConnectAccount = () => {
    if (typeof window.FB === 'undefined') {
      toast({
        title: 'Facebook SDK not loaded',
        description: 'Please wait a moment and try again.',
        variant: 'destructive',
      });
      return;
    }

    window.FB.login(
      (response: any) => {
        if (response.authResponse) {
          toast({ title: "Connecting to Instagram", description: "Finalizing connection..." });
          const accessToken = response.authResponse.accessToken;
          // In a real app, you'd now use this token to fetch data from the Instagram Graph API.
          // For this simulation, we'll just set our state to "connected".
          setIsLoadingToken(true);
          
          setTimeout(() => {
            setInstagramAccessToken(accessToken);
            setIsLoadingToken(false);
            toast({ title: "Instagram Connected!", description: "You can now analyze your profile." });
          }, 1500);

        } else {
          toast({
            title: 'Authorization Canceled',
            description: 'You did not connect your Instagram account.',
            variant: 'default',
          });
        }
      },
      { scope: 'instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list' }
    );
  };
  
  const handleAnalyzeProfile = async () => {
    if (!profileContent.trim()) {
      toast({ title: 'Missing Content', description: "Please paste your profile content to analyze.", variant: "destructive" });
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);
    toast({ title: 'Analysis Started', description: "The AI is working its magic..." });
    try {
      const result = await analyzeCreatorProfile({ profileContent });
      setAnalysisResult(result);
      toast({ title: 'Analysis Complete!', description: "Your brand insights are ready." });
    } catch (error: any) {
      console.error("Error analyzing creator profile:", error);
      toast({ title: "Analysis Failed", description: error.message || "Could not analyze the profile content.", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const isConnected = !!instagramAccessToken;

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
        description="Connect your social media accounts to analyze your brand and audience."
        actions={<Button variant="outline" onClick={() => startTour(insightsTour)}><LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour</Button>}
      />
      <div className="space-y-8">
        <Card id="connect-accounts-card">
          <CardHeader>
            <CardTitle>1. Connect Your Accounts</CardTitle>
            <CardDescription>
              Link your social platforms to begin importing your engagement data. Verza uses read-only access and will never post on your behalf.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Button variant={isConnected ? "secondary" : "outline"} size="lg" className="justify-start gap-3 p-6 text-lg" onClick={handleConnectAccount} disabled={isConnected || isLoadingToken}>
                {isLoadingToken ? <Loader2 className="h-6 w-6 animate-spin"/> : <Instagram className="h-6 w-6 text-pink-500" />}
                {isLoadingToken ? 'Connecting...' : isConnected ? 'Instagram Connected' : 'Connect Instagram'}
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
        
        {isConnected && (
            <Card id="analyze-profile-card">
                <CardHeader>
                    <CardTitle>2. Analyze Your Profile</CardTitle>
                    <CardDescription>Paste your profile bio and recent post captions/descriptions into the box below for the AI to analyze.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Textarea 
                        value={profileContent}
                        onChange={e => setProfileContent(e.target.value)}
                        placeholder="Paste your bio and recent post content here..."
                        rows={8}
                        disabled={isAnalyzing}
                    />
                    <Button onClick={handleAnalyzeProfile} disabled={isAnalyzing || !profileContent.trim()}>
                        {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Analyze My Brand
                    </Button>
                </CardContent>
            </Card>
        )}

        {isAnalyzing && (
             <Card>
                <CardContent className="p-10 flex flex-col items-center justify-center text-center">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <h3 className="text-lg font-semibold">Generating Insights...</h3>
                    <p className="text-muted-foreground">The AI is analyzing your profile. This might take a moment.</p>
                </CardContent>
             </Card>
        )}

        {analysisResult && (
            <Card id="insights-results-card" className="bg-muted/30">
                <CardHeader>
                    <CardTitle>Your AI-Generated Brand Insights</CardTitle>
                    <CardDescription>Here's what our AI found based on your content.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="p-4 border rounded-lg bg-background">
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Lightbulb className="text-yellow-500" />Your Mission Statement</h3>
                        <p className="text-muted-foreground italic">"{analysisResult.missionStatement}"</p>
                    </div>
                     <div className="p-4 border rounded-lg bg-background">
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Award className="text-blue-500" />Your Niche</h3>
                        <p className="text-muted-foreground">{analysisResult.niche}</p>
                    </div>
                     <div className="p-4 border rounded-lg bg-background">
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Star className="text-red-500" />Brand Wishlist</h3>
                        <ul className="list-disc list-inside grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {analysisResult.brandWishlist.map((brand, i) => <li key={i} className="text-muted-foreground">{brand}</li>)}
                        </ul>
                    </div>
                </CardContent>
            </Card>
        )}
      </div>
    </>
  );
}
