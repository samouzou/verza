"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  GraduationCap,
  Heart,
  Loader2,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db, functions } from "@/lib/firebase";
import type { StoreProduct } from "@/types";
import { cn } from "@/lib/utils";

function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 10_000_00;

type TipMode = "preset" | "custom";

export default function PublicStoreProductPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const productId = params.productId as string;
  const purchaseState = searchParams.get("purchase");

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyerEmail, setBuyerEmail] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [selectedTipCents, setSelectedTipCents] = useState<number | null>(null);
  const [tipMode, setTipMode] = useState<TipMode>("preset");
  const [customTipDollars, setCustomTipDollars] = useState("");

  useEffect(() => {
    if (!productId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "storeProducts", productId));
        if (!snap.exists()) {
          setError("This product doesn’t exist or was removed.");
          return;
        }
        const data = { id: snap.id, ...snap.data() } as StoreProduct;
        if ((data.kind || "link") === "tip") {
          const amounts = data.tipAmountsCents?.length
            ? data.tipAmountsCents
            : [data.priceCents];
          setSelectedTipCents(amounts[0]);
        }
        if (data.status !== "active" && purchaseState !== "success") {
          setError("This product is not currently for sale.");
          setProduct(data);
          return;
        }
        setProduct(data);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Could not load this product.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [productId, purchaseState]);

  const handleBuy = async () => {
    if (!product) return;
    setCheckoutError(null);

    const isTipProduct = (product.kind || "link") === "tip";
    const tipAmounts = product.tipAmountsCents?.length
      ? product.tipAmountsCents
      : [product.priceCents];
    const customTipCents = Math.round(parseFloat(customTipDollars) * 100);
    const tipAmountCents = isTipProduct
      ? tipMode === "custom"
        ? customTipCents
        : selectedTipCents || tipAmounts[0]
      : null;

    if (
      isTipProduct &&
      (!tipAmountCents ||
        !Number.isFinite(tipAmountCents) ||
        tipAmountCents < MIN_TIP_CENTS ||
        tipAmountCents > MAX_TIP_CENTS)
    ) {
      setCheckoutError("Enter a tip between $1.00 and $10,000.00.");
      return;
    }

    setCheckingOut(true);
    try {
      const createCheckout = httpsCallable(
        functions,
        "createStoreCheckoutSession"
      );
      const result = await createCheckout({
        productId: product.id,
        buyerEmail: buyerEmail.trim(),
        ...(isTipProduct && tipAmountCents
          ? { amountCents: tipAmountCents }
          : {}),
      });
      const url = (result.data as { url?: string })?.url;
      if (!url) throw new Error("No checkout URL returned");
      window.location.href = url;
    } catch (e: any) {
      setCheckoutError(e?.message || "Checkout failed. Try again.");
      setCheckingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="text-xl font-bold">Unavailable</h1>
          <p className="text-sm text-muted-foreground">
            {error || "Product not found"}
          </p>
          <Button asChild variant="outline">
            <Link href="https://tryverza.com">Back to Verza</Link>
          </Button>
        </div>
      </div>
    );
  }

  const productKind = product.kind || "link";
  const isCourse = productKind === "course";
  const isTip = productKind === "tip";
  const tipAmounts = product.tipAmountsCents?.length
    ? product.tipAmountsCents
    : [product.priceCents];
  const customTipCents = Math.round(parseFloat(customTipDollars) * 100);
  const isValidCustomTip =
    Number.isFinite(customTipCents) &&
    customTipCents >= MIN_TIP_CENTS &&
    customTipCents <= MAX_TIP_CENTS;
  const checkoutAmountCents = isTip
    ? tipMode === "custom"
      ? isValidCustomTip
        ? customTipCents
        : 0
      : selectedTipCents || tipAmounts[0]
    : product.priceCents;
  const canCheckoutTip =
    !isTip ||
    (tipMode === "custom" ? isValidCustomTip : Boolean(selectedTipCents));
  const outline =
    product.chapterOutline?.length
      ? product.chapterOutline
      : product.lessonOutline || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <div className="mb-8 flex items-center justify-between">
          <Link href="https://tryverza.com" className="flex items-center gap-2">
            <Image src="/verza-icon.svg" alt="Verza" width={28} height={21} />
            <span className="text-sm font-semibold tracking-tight">
              Verza Store
            </span>
          </Link>
          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {product.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.coverImageUrl}
              alt=""
              className="aspect-[16/9] w-full object-cover"
            />
          )}

          <div className="space-y-8 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              {product.creatorAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.creatorAvatarUrl}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {(product.creatorDisplayName || "C")
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  From
                </p>
                <p className="font-medium">
                  {product.creatorDisplayName || "Creator"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {isCourse && (
                <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  <GraduationCap className="h-3.5 w-3.5" />
                  Course · {outline.length} chapters
                </p>
              )}
              {isTip && (
                <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-violet-700 dark:text-violet-400">
                  <Heart className="h-3.5 w-3.5" />
                  Tip jar
                </p>
              )}
              <h1 className="text-3xl font-bold tracking-tight">
                {product.title}
              </h1>
              {product.description && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {product.description}
                </p>
              )}
            </div>

            {isCourse && outline.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">What’s inside</p>
                  <ol className="space-y-2">
                    {outline.map((chapter, i) => (
                      <li
                        key={chapter.id}
                        className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm"
                      >
                        <span className="font-medium">
                          {i + 1}. {chapter.title}
                        </span>
                        {chapter.summary && (
                          <p className="mt-0.5 text-muted-foreground">
                            {chapter.summary}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

            {isTip ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Choose an amount</p>
                  <div className="flex flex-wrap gap-2">
                    {tipAmounts.map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        variant={
                          tipMode === "preset" && selectedTipCents === amount
                            ? "default"
                            : "outline"
                        }
                        className={cn(
                          tipMode === "preset" &&
                            selectedTipCents === amount &&
                            "bg-violet-600 hover:bg-violet-700"
                        )}
                        onClick={() => {
                          setTipMode("preset");
                          setSelectedTipCents(amount);
                        }}
                      >
                        {formatUsd(amount)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="custom-tip-amount">Or enter a custom amount</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="custom-tip-amount"
                      type="number"
                      min="1"
                      max="10000"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="15.00"
                      value={customTipDollars}
                      onChange={(e) => {
                        setTipMode("custom");
                        setCustomTipDollars(e.target.value);
                      }}
                      onFocus={() => setTipMode("custom")}
                      className={cn(
                        "pl-7",
                        tipMode === "custom" &&
                          "ring-2 ring-violet-600 ring-offset-2 ring-offset-background"
                      )}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Minimum $1.00 · maximum $10,000.00
                  </p>
                  {tipMode === "custom" &&
                    customTipDollars.trim() &&
                    !isValidCustomTip && (
                      <p className="text-xs text-destructive">
                        Enter an amount between $1.00 and $10,000.00.
                      </p>
                    )}
                </div>
              </div>
            ) : (
              <p className="text-4xl font-bold tabular-nums tracking-tight">
                {formatUsd(product.priceCents)}
              </p>
            )}

            {purchaseState === "cancelled" && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                Checkout cancelled — you haven’t been charged.
              </p>
            )}

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="buyer-email">
                  {isTip ? "Email for receipt" : "Email for delivery"}
                </Label>
                <Input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@email.com"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                />
              </div>
              {checkoutError && (
                <p className="text-sm text-destructive">{checkoutError}</p>
              )}
              <Button
                className={cn("w-full", isTip && "bg-violet-600 hover:bg-violet-700")}
                size="lg"
                onClick={handleBuy}
                disabled={checkingOut || !buyerEmail.trim() || !canCheckoutTip}
              >
                {checkingOut && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isTip && checkoutAmountCents > 0
                  ? `Send ${formatUsd(checkoutAmountCents)} tip`
                  : isTip
                    ? "Send tip"
                    : "Buy now"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Secure checkout powered by Stripe.{" "}
                {isCourse
                  ? "Course access emailed after payment."
                  : isTip
                    ? "Receipt emailed after payment."
                    : "Access link emailed after payment."}{" "}
                {!isTip && (
                  <>
                    Already purchased?{" "}
                    <Link
                      href={`/s/${product.id}/access`}
                      className="underline underline-offset-2"
                    >
                      Open access
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
