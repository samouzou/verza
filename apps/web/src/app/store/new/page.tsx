"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import { emptyChapter } from "@/lib/store-editor";

export default function StoreNewProductPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kind = searchParams.get("kind") || "course";
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const started = useRef(false);

  useEffect(() => {
    if (authLoading || !user?.uid || started.current) return;
    if (kind !== "course") {
      router.replace("/store");
      return;
    }
    started.current = true;

    (async () => {
      try {
        const upsert = httpsCallable(functions, "upsertStoreProduct");
        const chapter = emptyChapter("Chapter 1");
        const result = await upsert({
          title: "Untitled course",
          description: "",
          priceCents: 100,
          kind: "course",
          status: "draft",
          chapters: [
            {
              id: chapter.id,
              title: chapter.title,
              body: "<p>Start writing your first chapter here.</p>",
              sortOrder: 0,
            },
          ],
        });
        const id = (result.data as { id?: string })?.id;
        if (!id) throw new Error("No product id returned");
        router.replace(`/store/${id}/edit`);
      } catch (e: any) {
        console.error(e);
        toast({
          title: "Couldn't create course",
          description: e?.message,
          variant: "destructive",
        });
        router.replace("/store");
      }
    })();
  }, [authLoading, user?.uid, kind, router, toast]);

  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Creating your course…</p>
    </div>
  );
}
