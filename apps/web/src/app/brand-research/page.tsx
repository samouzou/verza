
"use client";

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Wand2, UserCheck, Sparkles, Link as LinkIcon, BookOpen, Save, History, ExternalLink, Lightbulb, Mail, Copy, Check, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { BrandResearch } from '@/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';

function normalizeBrandName(value: string) {
  return value.trim().toLowerCase();
}

function guessBrandHomepage(name: string) {
  const trimmed = name.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\.[a-z]{2,}$/i.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed.replace(/^www\./i, '')}`;
  }
  const slug = trimmed
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  return slug ? `https://www.${slug}.com` : '';
}

function findExistingResearch(name: string, history: BrandResearch[]) {
  const needle = normalizeBrandName(name);
  if (!needle) return undefined;
  const slug = needle.replace(/[^a-z0-9]+/g, '');
  return history.find((item) => {
    if (normalizeBrandName(item.brandName || '') === needle) return true;
    const url = (item.brandUrl || '').toLowerCase();
    return !!slug && url.includes(slug);
  });
}

function BrandResearchContent() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const handledQueryBrand = useRef(false);

  const [brandUrl, setBrandUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const targetBrands = (user?.brandWishlist ?? []).filter((b) => typeof b === 'string' && b.trim());
  
  const [history, setHistory] = useState<BrandResearch[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [selectedReport, setSelectedReport] = useState<BrandResearch | null>(null);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

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
  
  const startResearch = async (rawUrl: string) => {
    if (!user) {
      toast({ title: "Authentication Error", variant: "destructive" });
      return;
    }
    const url = rawUrl.trim().startsWith('http') ? rawUrl.trim() : guessBrandHomepage(rawUrl);
    if (!url || !url.startsWith('http')) {
      toast({ title: "Invalid URL", description: "Please enter a valid website URL (e.g., https://brand.com).", variant: "destructive" });
      return;
    }

    setBrandUrl(url);
    setIsAnalyzing(true);
    setSelectedReport(null);
    toast({ title: "Research started", description: "This can take up to a minute." });

    try {
      const analyzeBrandCallable = httpsCallable(functions, 'analyzeBrand');
      const result = await analyzeBrandCallable({ brandUrl: url });
      const data = result.data as { success: boolean; researchId: string; report: Partial<BrandResearch> };

      if (data.success) {
        toast({ title: "Research ready", description: `${data.report.brandName} is ready to review.` });
      } else {
         throw new Error("The analysis function did not return a success status.");
      }
    } catch (error: any) {
      console.error("Error analyzing brand:", error);
      toast({ title: "Research failed", description: error.message || "Could not complete the brand analysis.", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
      setBrandUrl("");
    }
  };

  const handleAnalyzeBrand = () => {
    void startResearch(brandUrl);
  };

  const handleTargetBrand = (name: string) => {
    if (isAnalyzing) return;
    const existing = findExistingResearch(name, history);
    if (existing && existing.status !== 'failed') {
      setSelectedReport(existing);
      return;
    }
    void startResearch(guessBrandHomepage(name) || name);
  };

  useEffect(() => {
    if (handledQueryBrand.current || authLoading || !user || isLoadingHistory || isAnalyzing) return;
    const fromQuery = searchParams.get('brand')?.trim();
    if (!fromQuery) return;
    handledQueryBrand.current = true;
    handleTargetBrand(fromQuery);
  }, [authLoading, user, isLoadingHistory, isAnalyzing, searchParams, history]);
  
  const handleSaveToStrategy = () => {
      toast({ title: "Saved!", description: "This attack plan has been saved to your strategy book."});
  };

  const handleCopyToClipboard = (textToCopy: string, identifier: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedItem(identifier);
    toast({ title: "Copied!" });
    setTimeout(() => setCopiedItem(null), 2000);
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
                         <div className="space-y-2">
                          {report.report?.decisionMakers?.map((person, index) => (
                            <div key={index} className="text-sm p-2 bg-muted/50 rounded-md">
                              <p className="font-medium">{person.name || 'Unknown Name'}</p>
                              <p className="text-muted-foreground">{person.title}</p>
                              {person.email && <a href={`mailto:${person.email}`} className="text-primary hover:underline flex items-center gap-1 text-xs"><Mail className="h-3 w-3"/>{person.email}</a>}
                            </div>
                          ))}
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
                        {report.report?.pitchHooks?.map((hook, index) => <li key={index} className="text-sm text-muted-foreground pl-2">{hook}</li>)}
                    </ul>
                </div>
                 <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-2"><Mail className="h-5 w-5 text-primary" /> Email Pitches</h3>
                    <div className="space-y-4">
                      {report.report?.emailPitches?.map((pitch, index) => (
                        <Card key={index}>
                          <CardHeader>
                            <CardTitle className="text-lg flex justify-between items-center">
                              <span>Pitch {index + 1}</span>
                              <Button variant="ghost" size="sm" onClick={() => handleCopyToClipboard(pitch.subject, `subj-${index}`)}>
                                {copiedItem === `subj-${index}` ? <Check className="h-4 w-4 text-green-500"/> : <Copy className="h-4 w-4"/>}
                                <span className="ml-2">Copy Subject</span>
                              </Button>
                            </CardTitle>
                            <CardDescription>{pitch.subject}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="p-3 border rounded-md bg-muted/50 relative">
                                <Button variant="ghost" size="sm" className="absolute top-2 right-2" onClick={() => handleCopyToClipboard(pitch.body, `body-${index}`)}>
                                    {copiedItem === `body-${index}` ? <Check className="h-4 w-4 text-green-500"/> : <Copy className="h-4 w-4"/>}
                                    <span className="ml-2">Copy Body</span>
                                </Button>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{pitch.body}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                </div>
            </CardContent>
        </Card>
      )
  }

  return (
    <>
      <PageHeader
        title="Brand Research"
        description="This is your landing pad for the brands you want to work with. Research a target from your list, or paste any brand website."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Star className="text-primary h-5 w-5" /> Your target brands</CardTitle>
              <CardDescription>
                {targetBrands.length > 0
                  ? "Tap a brand to research it now. Brands you’ve already researched open instantly."
                  : "Your Insights target list will show up here. Until then, paste any brand website below."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {targetBrands.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {targetBrands.map((brand) => {
                    const existing = findExistingResearch(brand, history);
                    const ready = existing?.status === 'completed';
                    const pending = existing?.status === 'pending';
                    return (
                      <Button
                        key={brand}
                        type="button"
                        variant={ready ? "secondary" : "outline"}
                        size="sm"
                        disabled={isAnalyzing}
                        onClick={() => handleTargetBrand(brand)}
                        className="h-auto py-1.5"
                      >
                        {brand}
                        {ready && <Badge variant="outline" className="ml-2 text-[10px]">Ready</Badge>}
                        {pending && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Connect accounts in Creator Insights to generate your brand partner list, then research them here in one tap.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><LinkIcon className="text-primary h-5 w-5" /> Research another brand</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="brand-url">Brand website</Label>
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
                Research this brand
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
                <h3 className="mt-4 text-lg font-semibold">Pick a brand to research</h3>
                <p className="mt-1 text-sm text-muted-foreground">Start with a target from your list, paste a website, or open a report from history.</p>
            </div>
          }
        </div>
      </div>
    </>
  );
}

export default function BrandResearchPage() {
  return (
    <Suspense fallback={<div className="flex h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <BrandResearchContent />
    </Suspense>
  );
}
