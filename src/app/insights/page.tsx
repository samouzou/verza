
"use client";

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Instagram, Youtube, Sparkles, LifeBuoy, Lightbulb, Star, Award, RefreshCcw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTour } from "@/hooks/use-tour";
import { insightsTour } from "@/lib/tours";
import { Textarea } from '@/components/ui/textarea';
import { analyzeCreatorProfile, type CreatorAnalysisOutput } from '@/ai/flows/creator-analysis-flow';
import { db, doc, updateDoc, functions, auth, GoogleAuthProvider, linkWithPopup } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useRouter, useSearchParams } from 'next/navigation';

declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

const TikTokIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.35 1.92-3.58 3.17-5.91 3.21-2.43.05-4.86-.45-6.6-1.8-1.49-1.15-2.55-2.88-2.9-4.75-.24-1.25-.3-2.5-.3-3.75.02-3.48-.02-6.96.02-10.43.01-1.49.53-2.96 1.5-4.04 1.04-1.14 2.56-1.74 4.13-1.82.08-.01.15-.01.23-.01.02.52.01 1.05-.01 1.57-.21.53-.41 1.07-.63 1.6-.22.53-.46 1.05-.69 1.58-.04.1-.06.21-.07.32.02.05.04.09.06.13.25.5.53.98.83 1.44.31.47.65.92 1 1.35.02.02.04.04.05.06.02.04.02.09.01.14-.24 1.52-.52 3.03-.78 4.55-.01.05-.02.11-.02.16-.21-.05-.42-.09-.63-.15-.53-.15-1.07-.26-1.6-.42-.53-.16-1.07-.28-1.6-.45-.29-.09-.58-.15-.88-.23-.02-3.13.01-6.27-.02-9.4.04-.52.12-1.03.23-1.54.11-.5.25-1 .41-1.48.11-.33.24-.65.38-.97.16-.35.34-.69.54-1.03.02-.04.05-.07.08-.1.02.01.05.01.07.02z"/>
    </svg>
);

export default function InsightsPage() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const { toast } = useToast();
  const { startTour } = useTour();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [isSyncingIg, setIsSyncingIg] = useState(false);
  const [isSyncingYt, setIsSyncingYt] = useState(false);
  const [isSyncingTt, setIsSyncingTt] = useState(false);
  const [manualProfileContent, setManualProfileContent] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CreatorAnalysisOutput | null>(null);

  // Handle TikTok OAuth Callback
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    if (code && state === 'tiktok_auth') {
        // Clear query params
        router.replace('/insights');
        performTikTokSync(code);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  const performIgSync = async (accessToken: string) => {
    toast({ title: "Syncing Instagram", description: "Fetching verified content & engagement stats..." });
    setIsSyncingIg(true);
    
    try {
      const syncInstagramStats = httpsCallable(functions, 'syncInstagramStats');
      const result = await syncInstagramStats({ accessToken });
      const data = result.data as { success: boolean; followers: number; engagementRate: number };

      if (data.success) {
        await refreshAuthUser();
        toast({ 
          title: "Instagram Synced!", 
          description: `Imported ${data.followers.toLocaleString()} followers. Content aggregated for AI analysis.` 
        });
      }
    } catch (e: any) {
      console.error("Instagram sync failed:", e);
      toast({ 
        title: "Sync Failed", 
        description: e.message || "Ensure your Instagram is a Business account linked to a Page.", 
        variant: "destructive" 
      });
    } finally {
      setIsSyncingIg(false);
    }
  };

  const handleConnectInstagram = () => {
    if (typeof window.FB === 'undefined') {
      toast({ title: 'Meta SDK not loaded', description: 'Please wait a moment and try again.', variant: 'destructive' });
      return;
    }

    window.FB.login(
      function(response: any) {
        if (response.authResponse && user) {
          performIgSync(response.authResponse.accessToken);
        } else {
          toast({ title: 'Auth Canceled', description: 'Instagram connection was not completed.' });
        }
      },
      { 
        scope: 'public_profile,instagram_basic,pages_show_list,pages_read_engagement', 
        auth_type: 'rerequest' 
      }
    );
  };

  const performYoutubeSync = async (token: string) => {
    setIsSyncingYt(true);
    toast({ title: "Syncing YouTube", description: "Aggregating video data for analysis..." });
    try {
      const syncYouTubeStats = httpsCallable(functions, 'syncYouTubeStats');
      const syncResult = await syncYouTubeStats({ accessToken: token });
      const data = syncResult.data as { success: boolean; followers: number; engagementRate: number };

      if (data.success) {
        await refreshAuthUser();
        toast({ 
          title: "YouTube Synced!", 
          description: `Verified ${data.followers.toLocaleString()} subscribers. Content imported.` 
        });
      }
    } catch (error: any) {
      console.error("YouTube sync failed:", error);
      toast({ 
        title: "Sync Failed", 
        description: error.message || "Could not sync YouTube data.", 
        variant: "destructive" 
      });
    } finally {
      setIsSyncingYt(false);
    }
  };

  const handleConnectYoutube = async () => {
    if (!user || !auth.currentUser) return;
    setIsSyncingYt(true);
    toast({ title: "Connecting to YouTube", description: "Requesting access to channel stats..." });

    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
      provider.setCustomParameters({ prompt: 'select_account' });
      
      try {
        const result = await linkWithPopup(auth.currentUser, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential?.accessToken;

        if (!token) throw new Error("Could not obtain access token from Google.");
        await performYoutubeSync(token);
      } catch (linkError: any) {
        if (linkError.code === 'auth/credential-already-in-use') {
          const credential = GoogleAuthProvider.credentialFromError(linkError);
          const token = credential?.accessToken;
          if (token) {
            await performYoutubeSync(token);
            return;
          }
        }
        throw linkError;
      }
    } catch (error: any) {
      console.error("YouTube connection failed:", error);
      toast({ 
        title: "Connection Failed", 
        description: error.message || "Could not connect to YouTube.", 
        variant: "destructive"
      });
      setIsSyncingYt(false);
    }
  };

  const performTikTokSync = async (code: string) => {
    setIsSyncingTt(true);
    toast({ title: "Syncing TikTok", description: "Fetching verified follower counts..." });
    try {
        const syncTikTokStatsCallable = httpsCallable(functions, 'syncTikTokStats');
        const result = await syncTikTokStatsCallable({ authCode: code });
        const data = result.data as { success: boolean; followers: number };

        if (data.success) {
            await refreshAuthUser();
            toast({ title: "TikTok Synced!", description: `Verified ${data.followers.toLocaleString()} followers.` });
        }
    } catch (error: any) {
        console.error("TikTok sync error:", error);
        toast({ title: "Sync Failed", description: error.message || "Could not sync TikTok data.", variant: "destructive" });
    } finally {
        setIsSyncingTt(false);
    }
  };

  const handleConnectTikTok = async () => {
    const clientKey = "sbawwp6t4wfkbsrk3o";
    const redirectUri = encodeURIComponent(window.location.origin + "/insights");
    const scope = "user.info.basic,user.info.stats,video.list";
    const state = "tiktok_auth";
    
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${redirectUri}&state=${state}`;
    
    setIsSyncingTt(true);
    toast({ title: "Redirecting to TikTok", description: "Please authorize Verza to see your stats." });
    window.location.href = authUrl;
  };
  
  const handleAnalyzeProfile = async () => {
    if (!user) return;
    
    // Aggregate manual input with data from connected accounts
    const aggregatedContent = [
        manualProfileContent.trim(),
        user.socialContent?.instagram ? `[Instagram Content]: ${user.socialContent.instagram}` : '',
        user.socialContent?.youtube ? `[YouTube Content]: ${user.socialContent.youtube}` : '',
        user.socialContent?.tiktok ? `[TikTok Content]: ${user.socialContent.tiktok}` : '',
    ].filter(Boolean).join('\n\n');

    if (!aggregatedContent.trim()) {
      toast({ title: 'Missing Content', description: "Connect an account or paste your profile content to analyze.", variant: "destructive" });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);
    toast({ title: 'AI Analysis Started', description: "The system is analyzing your cross-platform content..." });
    
    try {
      const result = await analyzeCreatorProfile({ profileContent: aggregatedContent });
      setAnalysisResult(result);

      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
          missionStatement: result.missionStatement,
          niche: result.niche,
          brandWishlist: result.brandWishlist,
      });

      await refreshAuthUser();
      toast({ title: 'Analysis Complete!', description: "Your unified brand insights are now live." });
    } catch (error: any) {
      console.error("Error analyzing creator profile:", error);
      toast({ title: "Analysis Failed", description: error.message || "Could not analyze the profile content.", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const igConnected = !!user?.instagramConnected;
  const ytConnected = !!user?.youtubeConnected;
  const ttConnected = !!user?.tiktokConnected;
  const anyConnected = igConnected || ytConnected || ttConnected;

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
              Link your social platforms to begun importing verified metrics and content for AI analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Button 
              variant={igConnected ? "secondary" : "outline"} 
              size="lg" 
              className="justify-start gap-3 p-6 text-lg" 
              onClick={handleConnectInstagram} 
              disabled={isSyncingIg}
            >
                {isSyncingIg ? <Loader2 className="h-6 w-6 animate-spin"/> : igConnected ? <RefreshCcw className="h-6 w-6 text-green-500" /> : <Instagram className="h-6 w-6 text-pink-500" />}
                {isSyncingIg ? 'Syncing...' : igConnected ? 'Refresh Instagram' : 'Connect Instagram'}
            </Button>
            <Button 
              variant={ytConnected ? "secondary" : "outline"} 
              size="lg" 
              className="justify-start gap-3 p-6 text-lg" 
              onClick={handleConnectYoutube} 
              disabled={isSyncingYt}
            >
                {isSyncingYt ? <Loader2 className="h-6 w-6 animate-spin"/> : ytConnected ? <RefreshCcw className="h-6 w-6 text-green-500" /> : <Youtube className="h-6 w-6 text-red-500" />}
                {isSyncingYt ? 'Syncing...' : ytConnected ? 'Refresh YouTube' : 'Connect YouTube'}
            </Button>
            <Button 
              variant={ttConnected ? "secondary" : "outline"} 
              size="lg" 
              className="justify-start gap-3 p-6 text-lg" 
              onClick={handleConnectTikTok}
              disabled={isSyncingTt}
            >
                {isSyncingTt ? <Loader2 className="h-6 w-6 animate-spin"/> : <TikTokIcon />}
                {isSyncingTt ? 'Syncing...' : ttConnected ? 'Refresh TikTok' : 'Connect TikTok'}
            </Button>
          </CardContent>
        </Card>
        
        <Card id="analyze-profile-card">
            <CardHeader>
                <CardTitle>2. Unified Brand Analysis</CardTitle>
                <CardDescription>
                    {anyConnected 
                        ? "The AI will automatically use content from your connected accounts. You can add extra context below."
                        : "Paste your bio and recent post content below for AI brand analysis."
                    }
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Textarea 
                    value={manualProfileContent}
                    onChange={e => setManualProfileContent(e.target.value)}
                    placeholder="Tell the AI more about your style, goals, or upcoming projects..."
                    rows={6}
                    disabled={isAnalyzing}
                />
                <div className="flex items-center justify-between">
                    <Button onClick={handleAnalyzeProfile} disabled={isAnalyzing || (!manualProfileContent.trim() && !anyConnected)}>
                        {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        {anyConnected ? "Run Unified Analysis" : "Analyze My Brand"}
                    </Button>
                    {anyConnected && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 italic">
                            <Sparkles className="h-3 w-3 text-primary" /> Including data from {([igConnected, ytConnected, ttConnected].filter(Boolean).length)} connected platform(s)
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>

        {(analysisResult || user.missionStatement) && (
            <Card id="insights-results-card" className="bg-muted/30">
                <CardHeader>
                    <CardTitle>Your AI Brand Strategy</CardTitle>
                    <CardDescription>Based on your cross-platform content and verified data.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="p-4 border rounded-lg bg-background shadow-sm">
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Lightbulb className="text-yellow-500" />Your Mission Statement</h3>
                        <p className="text-muted-foreground italic">"{analysisResult?.missionStatement || user.missionStatement}"</p>
                    </div>
                     <div className="p-4 border rounded-lg bg-background shadow-sm">
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Award className="text-blue-500" />Your Specialized Niche</h3>
                        <p className="text-muted-foreground">{analysisResult?.niche || user.niche}</p>
                    </div>
                     <div className="p-4 border rounded-lg bg-background shadow-sm">
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Star className="text-red-500" />Top 5 Ideal Brand Partners</h3>
                        <ul className="list-disc list-inside grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                            {(analysisResult?.brandWishlist || user.brandWishlist || []).map((brand, i) => (
                                <li key={i} className="text-muted-foreground">{brand}</li>
                            ))}
                        </ul>
                    </div>
                </CardContent>
            </Card>
        )}
      </div>
    </>
  );
}
