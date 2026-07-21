"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import type { ChapterFormRow } from "@/lib/store-editor";
import { emptyChapter } from "@/lib/store-editor";

type OutlineResult = { title: string; summary?: string };

type SharedProps = {
  productId: string | null;
  courseTitle: string;
  courseDescription: string;
  disabled?: boolean;
};

async function callGenerateStoreCourseContent(payload: Record<string, unknown>) {
  const callable = httpsCallable(functions, "generateStoreCourseContent");
  const res = await callable(payload);
  return res.data as Record<string, unknown>;
}

export function outlineToChapterRows(outline: OutlineResult[]): ChapterFormRow[] {
  return outline.map((row) => ({
    ...emptyChapter(row.title),
    title: row.title,
    summary: row.summary || "",
  }));
}

export function CourseOutlineAiGenerator({
  productId,
  courseTitle,
  courseDescription,
  disabled,
  onApplyOutline,
  onApplyAllChapters,
}: SharedProps & {
  onApplyOutline: (chapters: ChapterFormRow[]) => void;
  onApplyAllChapters?: (chapters: ChapterFormRow[]) => void;
}) {
  const { toast } = useToast();
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [chapterCount, setChapterCount] = useState("5");
  const [loadingOutline, setLoadingOutline] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);

  const busy = Boolean(disabled || loadingOutline || loadingAll);

  const buildPayload = () => {
    const userPrompt = brief.trim();
    if (!userPrompt) {
      toast({
        variant: "destructive",
        title: "Add a course brief",
        description: "Describe what students will learn and who it's for.",
      });
      return null;
    }
    const count = Math.min(20, Math.max(1, parseInt(chapterCount, 10) || 5));
    return {
      userPrompt,
      courseTitle: courseTitle.trim() || undefined,
      courseDescription: courseDescription.trim() || undefined,
      audience: audience.trim() || undefined,
      chapterCount: count,
      productId: productId || undefined,
    };
  };

  const handleGenerateOutline = async () => {
    const base = buildPayload();
    if (!base) return;

    setLoadingOutline(true);
    try {
      const data = await callGenerateStoreCourseContent({
        mode: "outline",
        ...base,
      });
      const outline = data.chapters as OutlineResult[] | undefined;
      if (!outline?.length) throw new Error("Empty outline");
      onApplyOutline(outlineToChapterRows(outline));
      toast({
        title: "Outline ready",
        description: `${outline.length} chapters added — open each to write or generate bodies.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed.";
      toast({ variant: "destructive", title: "Outline", description: message });
    } finally {
      setLoadingOutline(false);
    }
  };

  const handleGenerateAll = async () => {
    const base = buildPayload();
    if (!base || !onApplyAllChapters) return;

    setLoadingAll(true);
    try {
      const outlineData = await callGenerateStoreCourseContent({
        mode: "outline",
        ...base,
      });
      const outline = outlineData.chapters as OutlineResult[] | undefined;
      if (!outline?.length) throw new Error("Empty outline");

      const chapters = outlineToChapterRows(outline);
      const filled: ChapterFormRow[] = [];

      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterData = await callGenerateStoreCourseContent({
          mode: "chapter",
          userPrompt: base.userPrompt,
          courseTitle: base.courseTitle,
          courseDescription: base.courseDescription,
          audience: base.audience,
          chapterTitle: chapter.title,
          chapterSummary: chapter.summary || undefined,
          chapterIndex: i,
          priorChapters: filled.map((c) => ({
            title: c.title,
            summary: c.summary || undefined,
          })),
          productId: productId || undefined,
        });
        filled.push({
          ...chapter,
          title: (chapterData.title as string) || chapter.title,
          summary: (chapterData.summary as string) || chapter.summary,
          body: (chapterData.bodyHtml as string) || "",
        });
      }

      onApplyAllChapters(filled);
      toast({
        title: "Full course draft ready",
        description: "Review each chapter before saving.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed.";
      toast({ variant: "destructive", title: "Course", description: message });
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-medium">AI course outline</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="course-ai-brief">What should this course teach?</Label>
        <Textarea
          id="course-ai-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. TikTok hook writing for fitness creators — from idea to CTA in 5 lessons."
          rows={3}
          disabled={busy}
          maxLength={4000}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="course-ai-audience">Audience (optional)</Label>
          <Input
            id="course-ai-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Beginner creators, 1–10k followers"
            disabled={busy}
            maxLength={200}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="course-ai-count">Chapters</Label>
          <Input
            id="course-ai-count"
            type="number"
            min={1}
            max={20}
            value={chapterCount}
            onChange={(e) => setChapterCount(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleGenerateOutline}
          disabled={busy}
        >
          {loadingOutline ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Generate outline
        </Button>
        {onApplyAllChapters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerateAll}
            disabled={busy}
          >
            {loadingAll ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Generate all chapters
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Outline fills titles and summaries. Full generation drafts every chapter
        body — review before publishing.
      </p>
    </div>
  );
}

export function CourseChapterAiGenerator({
  productId,
  courseTitle,
  courseDescription,
  chapter,
  chapterIndex,
  priorChapters,
  disabled,
  onApply,
}: SharedProps & {
  chapter: ChapterFormRow;
  chapterIndex: number;
  priorChapters: ChapterFormRow[];
  onApply: (patch: Partial<ChapterFormRow>) => void;
}) {
  const { toast } = useToast();
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);

  const hasBody = !isHtmlBodyEmpty(chapter.body);

  const handleGenerate = async (mode: "replace" | "append") => {
    const userPrompt =
      focus.trim() ||
      [courseTitle, chapter.title, chapter.summary].filter(Boolean).join(" — ");
    if (!userPrompt) {
      toast({
        variant: "destructive",
        title: "Add a focus",
        description: "Describe what this chapter should cover.",
      });
      return;
    }
    if (hasBody && mode === "replace") {
      const ok = window.confirm(
        "Replace existing chapter content with the AI draft?"
      );
      if (!ok) return;
    }

    setLoading(true);
    try {
      const data = await callGenerateStoreCourseContent({
        mode: "chapter",
        userPrompt,
        courseTitle: courseTitle.trim() || undefined,
        courseDescription: courseDescription.trim() || undefined,
        chapterTitle: chapter.title.trim() || undefined,
        chapterSummary: chapter.summary.trim() || undefined,
        chapterIndex,
        priorChapters: priorChapters.map((c) => ({
          title: c.title,
          summary: c.summary || undefined,
        })),
        productId: productId || undefined,
      });
      const bodyHtml = (data.bodyHtml as string)?.trim() || "";
      if (!bodyHtml) throw new Error("Empty chapter");

      onApply({
        title: (data.title as string) || chapter.title,
        summary: (data.summary as string) ?? chapter.summary,
        body:
          mode === "append" && chapter.body.trim()
            ? `${chapter.body}${bodyHtml}`
            : bodyHtml,
      });
      toast({
        title: "Chapter draft ready",
        description: "Review and edit before saving the course.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed.";
      toast({ variant: "destructive", title: "Chapter", description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-medium">AI chapter writer</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="chapter-ai-focus">Focus for this chapter</Label>
        <Textarea
          id="chapter-ai-focus"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="e.g. Walk through 3 hook formulas with examples and a homework exercise."
          rows={2}
          disabled={disabled || loading}
          maxLength={4000}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => handleGenerate("replace")}
          disabled={disabled || loading}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Generate chapter
        </Button>
        {hasBody && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleGenerate("append")}
            disabled={disabled || loading}
          >
            Append to body
          </Button>
        )}
      </div>
    </div>
  );
}

function isHtmlBodyEmpty(html: string) {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !text;
}
