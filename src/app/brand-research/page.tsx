
"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Wand2, UserCheck, Target, Sparkles, Link as LinkIcon, BookOpen, Save, History, ExternalLink, Lightbulb } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { BrandResearch } from '@/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';

export default function BrandResearchPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [brandUrl, setBrandUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [history, setHistory] = useState<BrandResearch[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [selectedReport, setSelectedReport] = useState<BrandResearch | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    setIsLoadingHistory(true);
    const q = query(
      collection(db, 'brand_research'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BrandResearch));
      setHistory(historyData);
      // If there's a pending analysis, select it automatically
      const pendingAnalysis = historyData.find(h => h.status === 'pending');
      if (pendingAnalysis && !selectedReport) {
          setSelectedReport(pendingAnalysis);
      }
      setIsLoadingHistory(false);
    }, (error) => {
      console.error("Error fetching brand research history:", error);
      toast({ title: "History Error", description: "Could not load research history.", variant: "destructive" });
      setIsLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [user, toast, selectedReport]);
  
  const handleAnalyzeBrand = async () => {
    if (!user) {
      toast({ title: "Authentication Error", variant: "destructive" });
      return;
    }
    if (!brandUrl.trim() || !brandUrl.startsWith('http')) {
      toast({ title: "Invalid URL", description: "Please enter a valid website URL (e.g., https://brand.com).", variant: "destructive" });
      return;
    }
    
    setIsAnalyzing(true);
    setSelectedReport(null);
    toast({ title: "Analysis Started", description: "AI is researching the brand. This can take up to a minute." });

    try {
      const analyzeBrandCallable = httpsCallable(functions, 'analyzeBrand');
      const result = await analyzeBrandCallable({ brandUrl });
      const data = result.data as { success: boolean; researchId: string; report: Partial<BrandResearch> };
      
      if (data.success) {
        toast({ title: "Analysis Complete!", description: `Attack plan for ${data.report.brandName} is ready.` });
        // The onSnapshot listener will pick up the new/updated document.
      } else {
         throw new Error("The analysis function did not return a success status.");
      }
    } catch (error: any) {
      console.error("Error analyzing brand:", error);
      toast({ title: "Analysis Failed", description: error.message || "Could not complete the brand analysis.", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
      setBrandUrl("");
    }
  };
  
  const handleSaveToStrategy = () => {
      toast({ title: "Saved!", description: "This attack plan has been saved to your strategy book."});
  };

  const ResultCard = ({ report }: { report: BrandResearch }) => {
      if (report.status === 'pending') {
          return (
             <Card className="shadow-lg animate-pulse">
                <CardHeader>
                    <CardTitle className="text-xl">Analyzing {report.brandUrl}...</CardTitle>
                    <CardDescription>The AI is currently researching this brand.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-64">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                </CardContent>
             </Card>
          );
      }
      
      if (report.status === 'failed') {
          return (
             <Card className="shadow-lg border-destructive">
                <CardHeader>
                    <CardTitle className="text-xl text-destructive">Analysis Failed for {report.brandUrl}</CardTitle>
                    <CardDescription>Something went wrong during the analysis.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{report.error || "An unknown error occurred."}</AlertDescription>
                    </Alert>
                </CardContent>
             </Card>
          );
      }
      
      return (
        <Card className="shadow-lg">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-2xl">{report.brandName}</CardTitle>
                        <CardDescription>
                            <a href={report.brandUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-sm">
                                {report.brandUrl} <ExternalLink className="h-3 w-3" />
                            </a>
                        </CardDescription>
                    </div>
                    <Button size="sm" onClick={handleSaveToStrategy}><Save className="mr-2 h-4 w-4" /> Save to Strategy</Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 className="font-semibold flex items-center gap-2 mb-2"><UserCheck className="h-5 w-5 text-primary" /> Target Decision Makers</h3>
                        <div className="flex flex-wrap gap-2">
                            {report.report?.decisionMakers.map(title => <Badge key={title} variant="secondary">{title}</Badge>)}
                        </div>
                    </div>
                    <div>
                        <h3 className="font-semibold flex items-center gap-2 mb-2"><Sparkles className="h-5 w-5 text-primary" /> Current Brand Vibe</h3>
                        <p className="text-sm text-muted-foreground">{report.report?.currentVibe}</p>
                    </div>
                </div>
                <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2"><Lightbulb className="h-5 w-5 text-primary" /> Pitch Hooks</h3>
                    <ul className="space-y-3 list-decimal list-inside">
                        {report.report?.pitchHooks.map((hook, index) => <li key={index} className="text-sm text-muted-foreground pl-2">{hook}</li>)}
                    </ul>
                </div>
            </CardContent>
        </Card>
      )
  }

  return (
    <>
      <PageHeader
        title="Brand Research Assistant"
        description="Enter a brand's website URL to generate an AI-powered pitch attack plan."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LinkIcon className="text-primary h-5 w-5" /> Analyze a Brand</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="brand-url">Brand Website URL</Label>
                <Input
                  id="brand-url"
                  value={brandUrl}
                  onChange={(e) => setBrandUrl(e.target.value)}
                  placeholder="https://www.apple.com"
                  disabled={isAnalyzing}
                />
              </div>
              <Button onClick={handleAnalyzeBrand} disabled={isAnalyzing || !brandUrl.trim()}>
                {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Generate Attack Plan
              </Button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><History className="text-primary h-5 w-5" /> Research History</CardTitle>
            </CardHeader>
            <CardContent>
                {isLoadingHistory ? <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin"/></div>
                : history.length === 0 ? <p className="text-muted-foreground text-center text-sm py-4">No research yet.</p>
                : <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                    {history.map(item => (
                        <div key={item.id} className="p-3 border rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedReport(item)}>
                            <p className="font-medium text-sm truncate">{item.brandName}</p>
                            <p className="text-xs text-muted-foreground">{formatDistanceToNow(item.createdAt.toDate(), { addSuffix: true })}</p>
                        </div>
                    ))}
                </div>}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {selectedReport ? <ResultCard report={selectedReport} /> 
          : history.length > 0 && !isLoadingHistory ? <ResultCard report={history[0]} />
          : <div className="flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg p-8 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">Your Report Will Appear Here</h3>
                <p className="mt-1 text-sm text-muted-foreground">Enter a URL to get started or select a report from your history.</p>
            </div>
          }
        </div>
      </div>
    </>
  );
}
