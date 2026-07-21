"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import "react-quill-new/dist/quill.snow.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUpload } from "@/components/ui/image-upload";
import { cn } from "@/lib/utils";
import {
  CourseChapterAiGenerator,
  CourseOutlineAiGenerator,
} from "@/components/store/course-ai-generator";
import {
  type ChapterFormRow,
  type CourseFormState,
  emptyChapter,
  incompleteChapterLabels,
  isHtmlBodyEmpty,
  chaptersToPayload,
} from "@/lib/store-editor";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote", "link"],
    ["clean"],
  ],
};

type EditorView = "settings" | string;

type CourseEditorProps = {
  productId: string | null;
  form: CourseFormState;
  onFormChange: (updater: (prev: CourseFormState) => CourseFormState) => void;
  onSave: (chapters?: ChapterFormRow[]) => Promise<void>;
  saving: boolean;
  loadingContent: boolean;
  connectReady: boolean;
  userId: string;
};

export function CourseEditor({
  productId,
  form,
  onFormChange,
  onSave,
  saving,
  loadingContent,
  connectReady,
  userId,
}: CourseEditorProps) {
  const [activeView, setActiveView] = useState<EditorView>("settings");
  const bodyDraftRef = useRef<{ id: string; html: string } | null>(null);

  const activeChapter = useMemo(() => {
    if (activeView === "settings") return null;
    return form.chapters.find((c) => c.id === activeView) || null;
  }, [activeView, form.chapters]);

  const activeChapterIndex = useMemo(() => {
    if (!activeChapter) return -1;
    return form.chapters.findIndex((c) => c.id === activeChapter.id);
  }, [activeChapter, form.chapters]);

  const updateChapter = useCallback(
    (id: string, patch: Partial<ChapterFormRow>) => {
      onFormChange((f) => ({
        ...f,
        chapters: f.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    [onFormChange]
  );

  const flushActiveBody = useCallback(() => {
    const draft = bodyDraftRef.current;
    if (!draft) return;
    updateChapter(draft.id, { body: draft.html });
  }, [updateChapter]);

  const goToView = useCallback(
    (view: EditorView) => {
      flushActiveBody();
      setActiveView(view);
    },
    [flushActiveBody]
  );

  useEffect(() => {
    if (activeChapter) {
      bodyDraftRef.current = {
        id: activeChapter.id,
        html: activeChapter.body,
      };
    }
  }, [activeChapter?.id, activeChapter?.body]);

  const incompleteChapters = useMemo(
    () => incompleteChapterLabels(form.chapters),
    [form.chapters]
  );

  const chaptersForSave = useCallback(() => {
    const draft = bodyDraftRef.current;
    if (!draft) return form.chapters;
    return form.chapters.map((chapter) =>
      chapter.id === draft.id ? { ...chapter, body: draft.html } : chapter
    );
  }, [form.chapters]);

  const handleSave = async () => {
    flushActiveBody();
    await onSave(chaptersForSave());
  };

  const addChapter = () => {
    const chapter = emptyChapter(`Chapter ${form.chapters.length + 1}`);
    onFormChange((f) => ({ ...f, chapters: [...f.chapters, chapter] }));
    goToView(chapter.id);
  };

  const removeChapter = (id: string) => {
    onFormChange((f) => {
      const next = f.chapters.filter((c) => c.id !== id);
      return { ...f, chapters: next.length ? next : [emptyChapter("Chapter 1")] };
    });
    if (activeView === id) goToView("settings");
  };

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col md:flex-row -mx-4 md:-mx-6 lg:-mx-8 -mb-6 lg:-mb-8">
      {/* Secondary nav — docked beside main sidebar, not floating */}
      <aside className="flex w-full shrink-0 flex-col border-b bg-muted/30 md:w-72 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
            <Link href="/store">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Store
            </Link>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Course
          </p>

          <button
            type="button"
            onClick={() => goToView("settings")}
            className={cn(
              "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
              activeView === "settings"
                ? "bg-background font-medium shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            )}
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            <span className="truncate">Course settings</span>
            {activeView === "settings" && (
              <ChevronRight className="ml-auto h-4 w-4 opacity-50" />
            )}
          </button>

          <div className="mb-2 mt-5 flex items-center justify-between px-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chapters
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={addChapter}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <ul className="space-y-0.5">
            {form.chapters.map((chapter, index) => (
              <li key={chapter.id}>
                <button
                  type="button"
                  onClick={() => goToView(chapter.id)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                    activeView === chapter.id
                      ? "bg-background font-medium shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  )}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-30" />
                  <BookOpen className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate">
                    {chapter.title.trim() || `Chapter ${index + 1}`}
                  </span>
                  {chapter.title.trim() && isHtmlBodyEmpty(chapter.body) && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                      title="Body not written yet"
                    />
                  )}
                  {form.chapters.length > 1 && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeChapter(chapter.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          removeChapter(chapter.id);
                        }
                      }}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t p-3 space-y-2">
          {incompleteChapters.length > 0 && form.status !== "active" && (
            <p className="text-xs text-muted-foreground">
              {incompleteChapters.length} chapter
              {incompleteChapters.length === 1 ? "" : "s"} still need a body.
              Draft saves are fine.
            </p>
          )}
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving || loadingContent}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {form.status === "active" ? "Save course" : "Save draft"}
          </Button>
        </div>
      </aside>

      {/* Main editor canvas */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
          {loadingContent && (
            <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading course content…
            </p>
          )}

          {activeView === "settings" && (
            <div className="space-y-8">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Course settings
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Title, cover, pricing, and publish status.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Cover image</Label>
                <ImageUpload
                  value={form.coverImageUrl || undefined}
                  folder={`store/${userId}/covers`}
                  label="Upload cover"
                  onChange={(url) =>
                    onFormChange((f) => ({ ...f, coverImageUrl: url }))
                  }
                  onRemove={() =>
                    onFormChange((f) => ({ ...f, coverImageUrl: "" }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="course-title">Title</Label>
                <Input
                  id="course-title"
                  value={form.title}
                  onChange={(e) =>
                    onFormChange((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder="Your course name"
                  maxLength={120}
                  className="text-lg"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="course-description">Description</Label>
                <Textarea
                  id="course-description"
                  value={form.description}
                  onChange={(e) =>
                    onFormChange((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="What students will learn — shown on your public page"
                  rows={4}
                  maxLength={2000}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="course-price">Price (USD)</Label>
                  <Input
                    id="course-price"
                    type="number"
                    min="1"
                    step="0.01"
                    value={form.priceDollars}
                    onChange={(e) =>
                      onFormChange((f) => ({
                        ...f,
                        priceDollars: e.target.value,
                      }))
                    }
                    placeholder="49.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v: CourseFormState["status"]) =>
                      onFormChange((f) => ({ ...f, status: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active" disabled={!connectReady}>
                        Active {connectReady ? "" : "(needs payouts)"}
                      </SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {productId && (
                <p className="text-xs text-muted-foreground">
                  Public link:{" "}
                  <Link
                    href={`/s/${productId}`}
                    target="_blank"
                    className="underline underline-offset-2"
                  >
                    /s/{productId}
                  </Link>
                </p>
              )}

              <CourseOutlineAiGenerator
                productId={productId}
                courseTitle={form.title}
                courseDescription={form.description}
                disabled={loadingContent || saving}
                onApplyOutline={(chapters) => {
                  const replace = form.chapters.some(
                    (c) =>
                      c.title.trim() ||
                      c.summary.trim() ||
                      !isHtmlBodyEmpty(c.body)
                  );
                  if (
                    replace &&
                    !window.confirm(
                      "Replace existing chapters with the AI outline?"
                    )
                  ) {
                    return;
                  }
                  onFormChange((f) => ({ ...f, chapters }));
                  if (chapters[0]) goToView(chapters[0].id);
                }}
                onApplyAllChapters={(chapters) => {
                  const replace = form.chapters.some(
                    (c) =>
                      c.title.trim() ||
                      c.summary.trim() ||
                      !isHtmlBodyEmpty(c.body)
                  );
                  if (
                    replace &&
                    !window.confirm(
                      "Replace all chapters with the full AI draft?"
                    )
                  ) {
                    return;
                  }
                  onFormChange((f) => ({ ...f, chapters }));
                  if (chapters[0]) goToView(chapters[0].id);
                }}
              />
            </div>
          )}

          {activeChapter && (
            <div className="space-y-8">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Chapter
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight">
                  {activeChapter.title.trim() || "Untitled chapter"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Body is private until purchase. Summary shows on the public
                  page.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="chapter-title">Chapter title</Label>
                <Input
                  id="chapter-title"
                  value={activeChapter.title}
                  onChange={(e) =>
                    updateChapter(activeChapter.id, { title: e.target.value })
                  }
                  placeholder="Introduction"
                  maxLength={120}
                  className="text-lg"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="chapter-summary">Public summary</Label>
                <Input
                  id="chapter-summary"
                  value={activeChapter.summary}
                  onChange={(e) =>
                    updateChapter(activeChapter.id, {
                      summary: e.target.value,
                    })
                  }
                  placeholder="One line teaser for the sales page (optional)"
                  maxLength={500}
                />
              </div>

              <CourseChapterAiGenerator
                productId={productId}
                courseTitle={form.title}
                courseDescription={form.description}
                chapter={activeChapter}
                chapterIndex={activeChapterIndex}
                priorChapters={form.chapters.slice(0, activeChapterIndex)}
                disabled={loadingContent || saving}
                onApply={(patch) => updateChapter(activeChapter.id, patch)}
              />

              <div className="space-y-2">
                <Label>Chapter body</Label>
                <div className="overflow-hidden rounded-lg border bg-card">
                  <ReactQuill
                    key={activeChapter.id}
                    theme="snow"
                    value={activeChapter.body}
                    onChange={(value) => {
                      bodyDraftRef.current = {
                        id: activeChapter.id,
                        html: value,
                      };
                      updateChapter(activeChapter.id, { body: value });
                    }}
                    onBlur={(_range, _source, editor) => {
                      const html = editor.getHTML();
                      bodyDraftRef.current = {
                        id: activeChapter.id,
                        html,
                      };
                      updateChapter(activeChapter.id, { body: html });
                    }}
                    modules={quillModules}
                    placeholder="Write your lesson — supports headings, lists, links, and formatting."
                    className="store-chapter-quill min-h-[320px] [&_.ql-container]:min-h-[280px] [&_.ql-editor]:min-h-[280px]"
                  />
                </div>
                {isHtmlBodyEmpty(activeChapter.body) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {form.status === "active"
                      ? "Add body content before publishing."
                      : "Optional for draft saves — required before you set status to Active."}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="chapter-resource">Resource link (optional)</Label>
                <Input
                  id="chapter-resource"
                  value={activeChapter.contentUrl}
                  onChange={(e) =>
                    updateChapter(activeChapter.id, {
                      contentUrl: e.target.value,
                    })
                  }
                  placeholder="Video, PDF, or download URL"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { chaptersToPayload, isHtmlBodyEmpty };