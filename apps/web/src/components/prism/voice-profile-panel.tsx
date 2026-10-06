"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2, NotebookPen, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLinkedInOsVoiceProfile } from "@/hooks/use-linkedin-os-voice";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

export function VoiceProfilePanel({ agencyId }: { agencyId: string }) {
  const { toast } = useToast();
  const { profile, loading, error } = useLinkedInOsVoiceProfile(agencyId);
  const [posts, setPosts] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (posts.trim().length < 200) {
      toast({
        title: "Paste more posts",
        description: "Need roughly 200+ characters of recent posts.",
        variant: "destructive",
      });
      return;
    }
    setAnalyzing(true);
    try {
      const analyze = httpsCallable(functions, "analyzeLinkedInOsVoiceProfile");
      await analyze({ posts: posts.trim() });
      toast({
        title: "Voice learned",
        description: "Drafts and weekly plans will use this profile.",
      });
      setPosts("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not analyze posts.";
      toast({ title: "Voice analysis failed", description: msg, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NotebookPen className="h-5 w-5 text-primary" />
          Voice
        </CardTitle>
        <CardDescription>
          Paste recent posts from any channel (the brand&apos;s or the founder&apos;s). Prism learns tone,
          hooks, and patterns, then plans and drafts in that voice.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : profile ? (
          <div className="rounded-lg border bg-muted/10 p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Saved profile</p>
              <Badge variant="secondary">{profile.samplePostCount} post samples</Badge>
            </div>
            <p className="text-muted-foreground whitespace-pre-wrap">{profile.voiceSummary}</p>
            {(profile.toneTraits?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Tone: {profile.toneTraits.join(" · ")}
              </p>
            )}
            {(profile.doList?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">Do: {profile.doList.slice(0, 4).join("; ")}</p>
            )}
            {(profile.dontList?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Don&apos;t: {profile.dontList.slice(0, 4).join("; ")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No voice profile yet. Paste 5–15 recent posts below to get started.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="voice-posts">Recent posts</Label>
          <Textarea
            id="voice-posts"
            rows={6}
            value={posts}
            onChange={(e) => setPosts(e.target.value.slice(0, 28000))}
            placeholder="Paste posts separated by blank lines…"
          />
          <p className="text-xs text-muted-foreground text-right">{posts.length}/28000</p>
        </div>
        <Button type="button" disabled={analyzing} onClick={() => void handleAnalyze()}>
          {analyzing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Learning voice…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              {profile ? "Re-learn from new posts" : "Learn voice"}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
