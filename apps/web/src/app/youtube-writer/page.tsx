"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  db,
  functions,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import type { YouTubeWriterDraft } from "@/types";
import { formatDistanceToNow } from "date-fns";
import {
  Loader2,
  Youtube,
  Wand2,
  Copy,
  Check,
  BookOpen,
  Save,
  History,
  Linkedin,
  Instagram,
} from "lucide-react";

type CopyTarget = "draft" | "linkedin" | "instagram";

export default function YouTubeWriterPage() {
  const { user, isCreator, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [adaptingPlatform, setAdaptingPlatform] = useState<"linkedin" | "instagram" | null>(null);

  const [resultText, setResultText] = useState<string | null>(null);
  const [resultVideoId, setResultVideoId] = useState<string | null>(null);
  const [linkedInText, setLinkedInText] = useState<string | null>(null);
  const [instagramText, setInstagramText] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);

  const [history, setHistory] = useState<YouTubeWriterDraft[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setHistory([]);
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    const q = query(
      collection(db, "youtube_writer_drafts"),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as YouTubeWriterDraft
        );
        setHistory(rows);
        setIsLoadingHistory(false);
      },
      (error) => {
        console.error("YouTube Writer history error:", error);
        toast({
          title: "History error",
          description: "Could not load saved drafts.",
          variant: "destructive",
        });
        setIsLoadingHistory(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, toast]);

  const flashCopied = (target: CopyTarget) => {
    setCopiedTarget(target);
    toast({ title: "Copied!" });
    setTimeout(() => setCopiedTarget(null), 2000);
  };

  const copyText = async (text: string, target: CopyTarget) => {
    await navigator.clipboard.writeText(text);
    flashCopied(target);
  };

  const loadDraft = (draft: YouTubeWriterDraft) => {
    setYoutubeUrl(draft.youtubeUrl || "");
    setPrompt(draft.prompt || "");
    setResultText(draft.text);
    setResultVideoId(draft.videoId || null);
    setLinkedInText(draft.linkedInText ?? null);
    setInstagramText(draft.instagramText ?? null);
    setSavedDraftId(draft.id);
    setCopiedTarget(null);
  };

  const handleGenerate = async () => {
    if (!youtubeUrl.trim()) {
      toast({
        title: "YouTube URL required",
        description: "Paste a public YouTube video link.",
        variant: "destructive",
      });
      return;
    }
    if (!prompt.trim()) {
      toast({
        title: "Prompt required",
        description: "Tell Gemini what to write about the video.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setResultText(null);
    setResultVideoId(null);
    setLinkedInText(null);
    setInstagramText(null);
    setSavedDraftId(null);
    setCopiedTarget(null);

    try {
      const writeFromYouTubeVideo = httpsCallable(functions, "writeFromYouTubeVideo");
      const result = await writeFromYouTubeVideo({
        youtubeUrl: youtubeUrl.trim(),
        prompt: prompt.trim(),
      });
      const data = result.data as { text?: string; videoId?: string };
      if (!data.text) {
        throw new Error("No text returned.");
      }
      setResultText(data.text);
      setResultVideoId(typeof data.videoId === "string" ? data.videoId : null);
      toast({ title: "Done", description: "Your draft is ready." });
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "Could not generate from that video.";
      console.error("YouTube Writer failed:", error);
      toast({ title: "Generation failed", description: message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!user?.uid || !resultText || !resultVideoId) return;

    setIsSaving(true);
    try {
      const youtubeCanonical = `https://www.youtube.com/watch?v=${resultVideoId}`;
      const payload = {
        uid: user.uid,
        videoId: resultVideoId,
        youtubeUrl: youtubeUrl.trim() || youtubeCanonical,
        prompt: prompt.trim(),
        text: resultText,
        linkedInText: linkedInText ?? null,
        instagramText: instagramText ?? null,
        updatedAt: serverTimestamp(),
      };

      if (savedDraftId) {
        await updateDoc(doc(db, "youtube_writer_drafts", savedDraftId), payload);
        toast({ title: "Saved", description: "Draft updated." });
      } else {
        const ref = await addDoc(collection(db, "youtube_writer_drafts"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        setSavedDraftId(ref.id);
        toast({ title: "Saved", description: "Draft added to your history." });
      }
    } catch (error: unknown) {
      console.error("Save draft failed:", error);
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "Could not save draft.";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const persistPlatformVariant = async (
    platform: "linkedin" | "instagram",
    text: string
  ) => {
    if (!savedDraftId) return;
    const field = platform === "linkedin" ? "linkedInText" : "instagramText";
    try {
      await updateDoc(doc(db, "youtube_writer_drafts", savedDraftId), {
        [field]: text,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Could not persist platform variant:", error);
    }
  };

  const handlePlatformCopy = async (platform: "linkedin" | "instagram") => {
    if (!resultText) return;

    const existing = platform === "linkedin" ? linkedInText : instagramText;
    const target: CopyTarget = platform;

    if (existing?.trim()) {
      await copyText(existing, target);
      return;
    }

    setAdaptingPlatform(platform);
    try {
      const adapt = httpsCallable(functions, "adaptYouTubeWriterDraft");
      const result = await adapt({ text: resultText, platform });
      const data = result.data as { text?: string };
      if (!data.text?.trim()) {
        throw new Error("No adapted text returned.");
      }

      if (platform === "linkedin") {
        setLinkedInText(data.text);
      } else {
        setInstagramText(data.text);
      }
      await persistPlatformVariant(platform, data.text);
      await copyText(data.text, target);
    } catch (error: unknown) {
      console.error("Platform adapt failed:", error);
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "Could not prepare that copy.";
      toast({
        title: "Adapt failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAdaptingPlatform(null);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isCreator) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center space-y-3">
        <Youtube className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-2xl font-bold">YouTube Writer is for creators</h1>
        <p className="text-muted-foreground">
          Paste a public YouTube link and prompt Gemini to write about the video.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="YouTube Writer"
        description="Paste a public YouTube link and tell Gemini what to write."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Youtube className="text-primary h-5 w-5" />
                Video + prompt
              </CardTitle>
              <CardDescription>
                Gemini watches the video natively — no transcript upload needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="youtube-url">YouTube URL</Label>
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  disabled={isGenerating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="youtube-prompt">Your prompt</Label>
                <Textarea
                  id="youtube-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Summarize the key points, then draft a LinkedIn post in my voice."
                  rows={6}
                  disabled={isGenerating}
                />
              </div>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !youtubeUrl.trim() || !prompt.trim()}
                className="w-full"
              >
                {isGenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                Generate
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="text-primary h-5 w-5" />
                Saved drafts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-muted-foreground text-center text-sm py-4">
                  No saved drafts yet.
                </p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`w-full text-left p-3 border rounded-md hover:bg-muted/50 ${
                        savedDraftId === item.id ? "border-primary bg-muted/40" : ""
                      }`}
                      onClick={() => loadDraft(item)}
                    >
                      <p className="font-medium text-sm truncate">
                        {item.prompt || item.videoId}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {item.videoId}
                        {item.createdAt?.toDate
                          ? ` · ${formatDistanceToNow(item.createdAt.toDate(), {
                              addSuffix: true,
                            })}`
                          : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {isGenerating ? (
            <Card className="shadow-lg animate-pulse">
              <CardHeader>
                <CardTitle className="text-xl">Watching the video…</CardTitle>
                <CardDescription>
                  This can take up to a couple of minutes for longer videos.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-center h-64">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
              </CardContent>
            </Card>
          ) : resultText ? (
            <Card className="shadow-lg">
              <CardHeader className="space-y-4">
                <div className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl">Draft</CardTitle>
                    {resultVideoId && (
                      <CardDescription className="mt-1">
                        From{" "}
                        <a
                          href={`https://www.youtube.com/watch?v=${resultVideoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          youtube.com/watch?v={resultVideoId}
                        </a>
                      </CardDescription>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    {savedDraftId ? "Update save" : "Save"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyText(resultText, "draft")}
                  >
                    {copiedTarget === "draft" ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Copy
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={adaptingPlatform !== null}
                    onClick={() => void handlePlatformCopy("linkedin")}
                  >
                    {adaptingPlatform === "linkedin" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : copiedTarget === "linkedin" ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Linkedin className="mr-2 h-4 w-4" />
                    )}
                    Copy LinkedIn
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={adaptingPlatform !== null}
                    onClick={() => void handlePlatformCopy("instagram")}
                  >
                    {adaptingPlatform === "instagram" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : copiedTarget === "instagram" ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Instagram className="mr-2 h-4 w-4" />
                    )}
                    Copy Instagram
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  LinkedIn / Instagram adapts the draft for that platform, then copies it.
                  Repeat clicks reuse the last adaptation.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-md border bg-muted/30 p-4 whitespace-pre-wrap text-sm leading-relaxed">
                  {resultText}
                </div>
                {(linkedInText || instagramText) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {linkedInText && (
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <Linkedin className="h-4 w-4" /> LinkedIn
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void copyText(linkedInText, "linkedin")}
                          >
                            {copiedTarget === "linkedin" ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <p className="text-xs whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
                          {linkedInText}
                        </p>
                      </div>
                    )}
                    {instagramText && (
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <Instagram className="h-4 w-4" /> Instagram
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void copyText(instagramText, "instagram")}
                          >
                            {copiedTarget === "instagram" ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <p className="text-xs whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
                          {instagramText}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[280px] border-2 border-dashed rounded-lg p-8 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">Your draft will appear here</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                Add a public YouTube link and a prompt, then generate — or open a saved draft.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
