"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import {
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Loader2,
  Lock,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { functions } from "@/lib/firebase";

type AccessChapter = {
  id: string;
  title: string;
  summary?: string | null;
  body: string;
  contentUrl?: string | null;
  sortOrder: number;
};

type AccessPayload =
  | {
      kind: "link";
      productTitle: string;
      accessUrl: string;
    }
  | {
      kind: "course";
      productTitle: string;
      productDescription?: string | null;
      coverImageUrl?: string | null;
      chapters: AccessChapter[];
      /** @deprecated Legacy field */
      lessons?: AccessChapter[];
    };

export default function StoreAccessPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const productId = params.productId as string;
  const purchaseSuccess = searchParams.get("purchase") === "success";
  const emailFromQuery = searchParams.get("email") || "";

  const [email, setEmail] = useState(emailFromQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessPayload | null>(null);

  const sortedChapters = useMemo(() => {
    if (!access || access.kind !== "course") return [];
    const chapters = access.chapters?.length
      ? access.chapters
      : access.lessons || [];
    return [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [access]);

  const unlock = async () => {
    setError(null);
    setLoading(true);
    setAccess(null);
    try {
      const getAccess = httpsCallable(functions, "getStoreAccess");
      const result = await getAccess({
        productId,
        buyerEmail: email.trim(),
      });
      setAccess(result.data as AccessPayload);
    } catch (e: any) {
      setError(
        e?.message ||
          "Could not unlock this purchase. Use the email from checkout."
      );
    } finally {
      setLoading(false);
    }
  };

  const showCourseContent = access?.kind === "course";

  return (
    <div className="min-h-screen bg-background">
      <div
        className={`mx-auto min-h-screen px-4 py-8 sm:py-12 ${
          showCourseContent ? "max-w-5xl" : "max-w-lg"
        }`}
      >
        <div className="mb-8 flex items-center justify-between">
          <Link href="https://tryverza.com" className="flex items-center gap-2">
            <Image src="/verza-icon.svg" alt="Verza" width={28} height={21} />
            <span className="text-sm font-semibold tracking-tight">
              Verza Store
            </span>
          </Link>
          <Lock className="h-4 w-4 text-muted-foreground" />
        </div>

        {purchaseSuccess && !access && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p>
              Payment received. Enter the email you used at checkout to open
              your content.
            </p>
          </div>
        )}

        {!access && (
          <div className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">Your purchase</h1>
              <p className="text-sm text-muted-foreground">
                We verify access with the email from your receipt — no Verza
                account required.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="access-email">Checkout email</Label>
                <Input
                  id="access-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                className="w-full"
                size="lg"
                onClick={unlock}
                disabled={loading || !email.trim()}
              >
                {loading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Unlock content
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              <Link
                href={`/s/${productId}`}
                className="underline underline-offset-2"
              >
                Back to product
              </Link>
            </p>
          </div>
        )}

        {access?.kind === "link" && (
          <div className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Purchased
              </p>
              <p className="text-lg font-semibold">{access.productTitle}</p>
            </div>
            <Button asChild className="w-full" size="lg">
              <a
                href={access.accessUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open access link
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setAccess(null)}
            >
              Use a different email
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <Link
                href={`/s/${productId}`}
                className="underline underline-offset-2"
              >
                Back to product
              </Link>
            </p>
          </div>
        )}

        {showCourseContent && (
          <div className="space-y-8">
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              {access.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={access.coverImageUrl}
                  alt=""
                  className="aspect-[21/9] w-full object-cover"
                />
              )}
              <div className="space-y-4 p-6 sm:p-8">
                <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  <GraduationCap className="h-3.5 w-3.5" />
                  Course · {sortedChapters.length}{" "}
                  {sortedChapters.length === 1 ? "chapter" : "chapters"}
                </p>
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    {access.productTitle}
                  </h1>
                  {access.productDescription && (
                    <p className="max-w-3xl whitespace-pre-wrap text-muted-foreground">
                      {access.productDescription}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Course content</h2>
                  <p className="text-sm text-muted-foreground">
                    Expand a chapter to read the full lesson.
                  </p>
                </div>
              </div>

              <Accordion
                type="single"
                collapsible
                defaultValue={sortedChapters[0]?.id}
                className="space-y-3"
              >
                {sortedChapters.map((chapter, i) => (
                  <AccordionItem
                    key={chapter.id}
                    value={chapter.id}
                    className="overflow-hidden rounded-xl border border-b bg-card px-4 shadow-sm data-[state=open]:ring-1 data-[state=open]:ring-border sm:px-5"
                  >
                    <AccordionTrigger className="py-5 hover:no-underline">
                      <div className="min-w-0 pr-4 text-left">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Chapter {i + 1}
                        </p>
                        <p className="mt-1 text-base font-semibold sm:text-lg">
                          {chapter.title}
                        </p>
                        {chapter.summary && (
                          <p className="mt-1 line-clamp-2 text-sm font-normal text-muted-foreground">
                            {chapter.summary}
                          </p>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-5">
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none border-t pt-5 sm:prose-base"
                        dangerouslySetInnerHTML={{ __html: chapter.body }}
                      />
                      {chapter.contentUrl && (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="mt-5"
                        >
                          <a
                            href={chapter.contentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open resource
                            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" onClick={() => setAccess(null)}>
                Use a different email
              </Button>
              <p className="text-center text-xs text-muted-foreground sm:text-right">
                <Link
                  href={`/s/${productId}`}
                  className="underline underline-offset-2"
                >
                  Back to product
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
