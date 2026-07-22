"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";
import { CourseEditor } from "@/components/store/course-editor";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import {
  chaptersToPayload,
  chaptersWithTitle,
  courseReadyToPublish,
  emptyCourseForm,
  incompleteChapterLabels,
  mapLoadedChapters,
  type ChapterFormRow,
  type CourseFormState,
} from "@/lib/store-editor";
import type { StoreChapterContent, StoreProduct, StoreProductKind } from "@/types";

export default function StoreCourseEditPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.productId as string;
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState<CourseFormState>(emptyCourseForm);
  const [salesCount, setSalesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);

  const isCreator =
    user?.role === "individual_creator" || user?.role === "talent";
  const connectReady = !!(user?.stripeAccountId && user?.stripePayoutsEnabled);

  useEffect(() => {
    if (!productId || authLoading) return;
    if (!user?.uid || !isCreator) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "storeProducts", productId));
        if (!snap.exists()) {
          toast({
            title: "Product not found",
            variant: "destructive",
          });
          router.replace("/store");
          return;
        }
        const product = { id: snap.id, ...snap.data() } as StoreProduct;
        if (product.creatorId !== user.uid) {
          toast({ title: "Not your product", variant: "destructive" });
          router.replace("/store");
          return;
        }
        if ((product.kind || "link") !== "course") {
          router.replace("/store");
          return;
        }

        setForm({
          title: product.title,
          description: product.description || "",
          priceDollars: (product.priceCents / 100).toFixed(2),
          kind: "course",
          coverImageUrl: product.coverImageUrl || "",
          accessUrl: "",
          chapters: mapLoadedChapters(
            undefined,
            (product.chapterOutline || product.lessonOutline)?.map((c) => ({
              id: c.id,
              title: c.title,
              summary: c.summary,
              body: "",
              contentUrl: "",
              sortOrder: 0,
            }))
          ),
          status: product.status,
        });
        setSalesCount(product.salesCount || 0);

        setLoadingContent(true);
        const getContent = httpsCallable(functions, "getStoreProductContent");
        const result = await getContent({ productId });
        const data = result.data as {
          kind?: StoreProductKind;
          chapters?: StoreChapterContent[];
          lessons?: Array<StoreChapterContent & { contentUrl?: string }>;
        };
        setForm((f) => ({
          ...f,
          chapters: mapLoadedChapters(data.chapters, data.lessons),
        }));
      } catch (e: any) {
        console.error(e);
        toast({
          title: "Couldn't load course",
          description: e?.message,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
        setLoadingContent(false);
      }
    };

    load();
  }, [productId, user?.uid, isCreator, authLoading, router, toast]);

  const handleSave = async (chaptersOverride?: ChapterFormRow[]) => {
    const chapters = chaptersOverride ?? form.chapters;
    const price = Math.round(parseFloat(form.priceDollars) * 100);
    if (!form.title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(price) || price < 100) {
      toast({
        title: "Invalid price",
        description: "Minimum price is $1.00",
        variant: "destructive",
      });
      return;
    }
    const validChapters = chaptersWithTitle(chapters);
    if (validChapters.length === 0) {
      toast({ title: "Add at least one chapter", variant: "destructive" });
      return;
    }
    if (form.status === "active" && !courseReadyToPublish(chapters)) {
      const missing = incompleteChapterLabels(chapters);
      toast({
        title: "Finish all chapters before publishing",
        description:
          missing.length > 0
            ? `Still need body content: ${missing.join(", ")}`
            : "Each chapter needs body content.",
        variant: "destructive",
      });
      return;
    }
    if (form.status === "active" && !connectReady) {
      toast({
        title: "Connect payouts required",
        description: "Enable payouts in Settings before publishing.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const upsert = httpsCallable(functions, "upsertStoreProduct");
      await upsert({
        productId,
        title: form.title.trim(),
        description: form.description.trim(),
        priceCents: price,
        kind: "course",
        coverImageUrl: form.coverImageUrl.trim() || null,
        chapters: chaptersToPayload(chapters),
        status: form.status,
      });
      toast({ title: "Course saved" });
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message || "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isCreator || !user?.uid) {
    return null;
  }

  return (
    <CourseEditor
      productId={productId}
      salesCount={salesCount}
      form={form}
      onFormChange={setForm}
      onSave={handleSave}
      saving={saving}
      loadingContent={loadingContent}
      connectReady={connectReady}
      userId={user.uid}
    />
  );
}
