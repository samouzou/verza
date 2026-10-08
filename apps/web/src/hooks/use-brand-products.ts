"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { BrandKit, BrandProduct } from "@/types";

export type BrandProductInput = Omit<BrandProduct, "id">;

export const MAX_PRODUCT_IMAGES = 6;

/** Every image for a product, main image first. Older products only have `imageUrl`. */
export function productImages(p: Pick<BrandProduct, "imageUrl" | "images">): string[] {
  if (p.images?.length) return p.images;
  return p.imageUrl ? [p.imageUrl] : [];
}

/** Reads and writes the brand kit product catalog at agencies/{id}/private/brandKit. */
export function useBrandProducts(agencyId: string | null | undefined) {
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agencyId) {
      setProducts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [agencySnap, kitSnap] = await Promise.all([
          getDoc(doc(db, "agencies", agencyId)),
          getDoc(doc(db, "agencies", agencyId, "private", "brandKit")).catch(() => null),
        ]);
        const kit = (kitSnap?.exists() ? kitSnap.data() : {}) as BrandKit;
        const legacy = agencySnap.exists() ? (agencySnap.data().products as BrandProduct[] | undefined) : undefined;
        if (!cancelled) setProducts(kit.products ?? legacy ?? []);
      } catch (e) {
        console.error("Error loading products:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agencyId]);

  const persist = useCallback(
    async (next: BrandProduct[]) => {
      if (!agencyId) throw new Error("No agency selected.");
      await setDoc(
        doc(db, "agencies", agencyId, "private", "brandKit"),
        { products: next, updatedAt: new Date() },
        { merge: true }
      );
      setProducts(next);
    },
    [agencyId]
  );

  /** Adds a product, or replaces the one with `id`. */
  const upsert = useCallback(
    async (input: BrandProductInput, id?: string) => {
      const images = productImages(input).slice(0, MAX_PRODUCT_IMAGES);
      const clean: BrandProductInput = { ...input, images, imageUrl: images[0] ?? "" };
      const next = id
        ? products.map((p) => (p.id === id ? { ...clean, id } : p))
        : [...products, { ...clean, id: crypto.randomUUID() }];
      await persist(next);
    },
    [persist, products]
  );

  const remove = useCallback(
    async (id: string) => persist(products.filter((p) => p.id !== id)),
    [persist, products]
  );

  return { products, loading, upsert, remove };
}
