
"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertTriangle, Sparkles, Video, Download, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateScene } from '@/ai/flows/generate-scene-flow';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Generation } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;

export default function SceneSpawnerPage() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof styleOptions)[number]>("Realistic");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);

  const [history, setHistory] = useState<Generation[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;

    setIsLoadingHistory(true);
    const q = query(
      collection(db, 'generations'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Generation)));
      setIsLoadingHistory(false);
    }, (error) => {
      console.error("Error fetching generation history:", error);
      toast({ title: "History Error", description: "Could not load generation history.", variant: "destructive" });
      setIsLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [user, toast]);

  const handleSpawnScene = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to generate scenes.", variant: "destructive" });
      return;
    }
    if (!prompt.trim()) {
      toast({ title: "Prompt Required", description: "Please enter a prompt for your scene.", variant: "destructive" });
      return;
    }
    if ((user.credits ?? 0) <= 0) {
      toast({ title: "No Credits", description: "You have no more spawns left.", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    setGeneratedVideoUrl(null);
    toast({ title: "Spawning Scene...", description: "AI is generating your video. This may take a minute or two." });

    try {
      const result = await generateScene({ userId: user.uid, prompt, style });
      setGeneratedVideoUrl(result.videoUrl);
      toast({ title: "Scene Spawned!", description: `Your video is ready. You have ${result.remainingCredits} credits left.` });
      await refreshAuthUser(); // Refresh user data to get updated credits
    } catch (error: any) {
      console.error("Error generating scene:", error);
      toast({ title: "Generation Failed", description: error.message || "An unknown error occurred.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const credits = user?.credits ?? 0;

  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  return (
    <>
      <PageHeader
        title="Scene Spawner"
        description="Generate short video clips and B-roll for your content using AI."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-6 w-6 text-primary" />Generator</CardTitle>
              <CardDescription>Describe the scene you want to create.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="prompt">Prompt</Label>
                <Input
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., A cyberpunk street in the rain, neon signs reflecting on wet pavement"
                  disabled={isGenerating}
                />
              </div>
              <div>
                <Label htmlFor="style">Style</Label>
                <Select value={style} onValueChange={(value) => setStyle(value as any)} disabled={isGenerating}>
                  <SelectTrigger id="style"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {styleOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Button onClick={handleSpawnScene} disabled={isGenerating || credits <= 0}>
                  {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Spawn Scene ({credits} {credits === 1 ? 'Credit' : 'Credits'} Left)
                </Button>
                {credits <= 0 && <p className="text-sm text-destructive">No spawns left.</p>}
              </div>
            </CardContent>
          </Card>
          
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Video className="h-6 w-6 text-primary" />Generated Scene</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center bg-black rounded-b-lg aspect-video">
              {isGenerating ? (
                <div className="text-center text-primary-foreground">
                  <Loader2 className="h-12 w-12 animate-spin mx-auto" />
                  <p className="mt-4">Generating... may take up to 2 mins</p>
                </div>
              ) : generatedVideoUrl ? (
                <div className="relative w-full h-full">
                  <video src={generatedVideoUrl} controls autoPlay loop className="w-full h-full object-contain" />
                  <Button asChild size="sm" className="absolute top-2 right-2">
                    <a href={generatedVideoUrl} download target="_blank" rel="noopener noreferrer">
                      <Download className="mr-2 h-4 w-4" /> Download
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <p>Your video will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />History</CardTitle>
              <CardDescription>Your previously spawned scenes.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh_-_18rem)]">
                {isLoadingHistory ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div>
                 : history.length > 0 ? (
                  <div className="space-y-4">
                    {history.map(item => (
                      <div key={item.id} className="p-3 border rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => setGeneratedVideoUrl(item.videoUrl)}>
                        <p className="text-sm truncate">{item.prompt}</p>
                        <p className="text-xs text-muted-foreground flex items-center justify-between">
                          <span>{item.style}</span>
                          <span>{formatDistanceToNow(item.timestamp.toDate(), { addSuffix: true })}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                 ) : <p className="text-center text-muted-foreground py-6">No history yet.</p>}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
