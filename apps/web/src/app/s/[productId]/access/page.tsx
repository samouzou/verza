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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
        <div className="mb-8 flex items-center justify-between">
          <Link href="https://tryverza.com" className="flex items-center gap-2">
            <Image src="/verza-icon.svg" alt="Verza" width={28} height={21} />
            <span className="text-sm font-semibold tracking-tight">
              Verza Store
            </span>
          </Link>
          <Lock className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {purchaseSuccess && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <p>
                Payment received. Enter the email you used at checkout to open
                your content.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Your purchase</h1>
            <p className="text-sm text-muted-foreground">
              We verify access with the email from your receipt — no Verza
              account required.
            </p>
          </div>

          {!access && (
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
          )}

          {access?.kind === "link" && (
            <div className="space-y-4">
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
            </div>
          )}

          {access?.kind === "course" && (
            <div className="space-y-5">
              <div>
                <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  <GraduationCap className="h-3.5 w-3.5" />
                  Course
                </p>
                <p className="text-lg font-semibold">{access.productTitle}</p>
              </div>
              <div className="space-y-6">
                {sortedChapters.map((chapter, i) => (
                  <article
                    key={chapter.id}
                    className="rounded-lg border px-4 py-4"
                  >
                    <h2 className="text-base font-semibold">
                      {i + 1}. {chapter.title}
                    </h2>
                    {chapter.summary && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {chapter.summary}
                      </p>
                    )}
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                      {chapter.body}
                    </div>
                    {chapter.contentUrl && (
                      <Button asChild size="sm" variant="outline" className="mt-4">
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
                  </article>
                ))}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setAccess(null)}
              >
                Use a different email
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            <Link
              href={`/s/${productId}`}
              className="underline underline-offset-2"
            >
              Back to product
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
