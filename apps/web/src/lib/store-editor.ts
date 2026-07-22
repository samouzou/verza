import type { StoreChapterContent, StoreProduct, StoreProductKind } from "@/types";

export type ChapterFormRow = {
  id: string;
  title: string;
  summary: string;
  body: string;
  contentUrl: string;
};

export type CourseFormState = {
  title: string;
  description: string;
  priceDollars: string;
  kind: StoreProductKind;
  coverImageUrl: string;
  accessUrl: string;
  chapters: ChapterFormRow[];
  status: "draft" | "active" | "archived";
};

export function emptyChapter(title = ""): ChapterFormRow {
  return {
    id: `chapter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    summary: "",
    body: "",
    contentUrl: "",
  };
}

export function emptyCourseForm(): CourseFormState {
  return {
    title: "",
    description: "",
    priceDollars: "",
    kind: "course",
    coverImageUrl: "",
    accessUrl: "",
    chapters: [emptyChapter("Chapter 1")],
    status: "draft",
  };
}

export function chapterCount(product: StoreProduct) {
  return product.chapterOutline?.length || product.lessonOutline?.length || 0;
}

/** True when Quill/HTML body has no meaningful text. */
export function isHtmlBodyEmpty(html: string) {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !text;
}

export function chaptersWithTitle(chapters: ChapterFormRow[]) {
  return chapters.filter((c) => c.title.trim());
}

export function incompleteChapterLabels(chapters: ChapterFormRow[]) {
  return chaptersWithTitle(chapters)
    .filter((c) => isHtmlBodyEmpty(c.body))
    .map((c, i) => c.title.trim() || `Chapter ${i + 1}`);
}

export function courseReadyToPublish(chapters: ChapterFormRow[]) {
  const titled = chaptersWithTitle(chapters);
  return titled.length > 0 && titled.every((c) => !isHtmlBodyEmpty(c.body));
}

export function chaptersToPayload(chapters: ChapterFormRow[]) {
  return chapters
    .filter((c) => c.title.trim())
    .map((c, i) => ({
      id: c.id,
      title: c.title.trim(),
      summary: c.summary.trim() || undefined,
      body: c.body.trim(),
      contentUrl: c.contentUrl.trim() || undefined,
      sortOrder: i,
    }));
}

export function mapLoadedChapters(
  chapters?: StoreChapterContent[],
  legacyLessons?: Array<StoreChapterContent & { contentUrl?: string }>
): ChapterFormRow[] {
  const source = chapters?.length ? chapters : legacyLessons;
  if (!source?.length) return [emptyChapter("Chapter 1")];
  return source.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary || "",
    body: c.body || "",
    contentUrl: c.contentUrl || "",
  }));
}
