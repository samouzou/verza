"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Star, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaUpload } from "@/components/ui/media-upload";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PRODUCT_IMAGES, productImages, type BrandProductInput } from "@/hooks/use-brand-products";
import { useToast } from "@/hooks/use-toast";
import { getDownloadURL, ref, storage, uploadBytes } from "@/lib/firebase";
import type { BrandProduct } from "@/types";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const EMPTY: BrandProductInput = {
  name: "",
  description: "",
  price: 0,
  url: "",
  imageUrl: "",
  images: [],
  videoUrl: "",
  usps: [],
};

/** Upload grid for several product images. The first image is the main one. */
export function ProductImagesField({
  images,
  onChange,
  hint,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  hint?: string;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PRODUCT_IMAGES - images.length;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room);
    const tooBig = picked.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig.length) {
      toast({ title: "Image too large", description: "Keep each image under 15 MB.", variant: "destructive" });
    }
    const ok = picked.filter((f) => f.size <= MAX_IMAGE_BYTES);
    if (!ok.length) return;
    setUploading(ok.length);
    try {
      const urls = await Promise.all(
        ok.map(async (file) => {
          const r = ref(storage, `products/images/${Date.now()}_${file.name}`);
          await uploadBytes(r, file);
          return getDownloadURL(r);
        })
      );
      onChange([...images, ...urls]);
    } catch (e: unknown) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Could not upload.",
        variant: "destructive",
      });
    } finally {
      setUploading(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {images.map((url, i) => (
          <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted/30">
            <img src={url} alt="" className="h-full w-full object-contain" />
            {i === 0 ? (
              <span className="absolute left-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
                Main
              </span>
            ) : (
              <button
                type="button"
                aria-label="Make main image"
                onClick={() => onChange([url, ...images.filter((_, j) => j !== i)])}
                className="absolute left-1 top-1 rounded bg-background/90 p-1 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Star className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => onChange(images.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 rounded-full bg-destructive p-1 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {images.length + uploading < MAX_PRODUCT_IMAGES && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading > 0}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:bg-muted/40"
          >
            {uploading > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            <span className="text-xs">{uploading > 0 ? "Uploading…" : "Add images"}</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />
      <p className="text-xs text-muted-foreground">
        Up to {MAX_PRODUCT_IMAGES} images. {hint ?? "The first one is the main image."}
      </p>
    </div>
  );
}

/** Add / edit dialog for one brand kit product. */
export function ProductDialog({
  open,
  onOpenChange,
  product,
  onSave,
  noun = "Product",
  imageHint,
  showVideo = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: BrandProduct | null;
  onSave: (input: BrandProductInput) => Promise<void>;
  noun?: string;
  imageHint?: string;
  showVideo?: boolean;
}) {
  const [form, setForm] = useState<BrandProductInput>(EMPTY);
  const [newUSP, setNewUSP] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      product
        ? {
            name: product.name,
            description: product.description,
            price: product.price,
            url: product.url,
            imageUrl: product.imageUrl,
            images: productImages(product),
            videoUrl: product.videoUrl || "",
            usps: product.usps || [],
          }
        : EMPTY
    );
    setNewUSP("");
  }, [open, product]);

  const addUSP = () => {
    if (!newUSP.trim()) return;
    setForm((f) => ({ ...f, usps: [...f.usps, newUSP.trim()] }));
    setNewUSP("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(form);
      onOpenChange(false);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  };

  const images = form.images ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? `Edit ${noun.toLowerCase()}` : `Add ${noun.toLowerCase()}`}</DialogTitle>
          <DialogDescription>
            Used by creator campaigns and by Prism when it writes posts and makes graphics.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="product-name">Name</Label>
            <Input
              id="product-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Images</Label>
            <ProductImagesField
              images={images}
              onChange={(next) => setForm({ ...form, images: next, imageUrl: next[0] ?? "" })}
              hint={imageHint}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="min-h-[80px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="product-price">Price ($)</Label>
              <Input
                id="product-price"
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-url">URL</Label>
              <Input
                id="product-url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Selling points</Label>
            <div className="flex gap-2">
              <Input
                value={newUSP}
                onChange={(e) => setNewUSP(e.target.value)}
                placeholder="e.g. 100% organic"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addUSP();
                  }
                }}
              />
              <Button type="button" variant="secondary" size="icon" onClick={addUSP}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.usps.map((usp, i) => (
                <div key={i} className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                  {usp}
                  <button
                    type="button"
                    aria-label="Remove selling point"
                    onClick={() => setForm({ ...form, usps: form.usps.filter((_, j) => j !== i) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {showVideo && (
            <div className="space-y-2">
              <Label>Video (optional)</Label>
              <MediaUpload
                value={form.videoUrl}
                onChange={(url) => setForm({ ...form, videoUrl: url })}
                onRemove={() => setForm({ ...form, videoUrl: "" })}
                label="Motion / B-Roll"
                accept="video/*"
                folder="products/videos"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !form.name.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {product ? "Save changes" : `Add ${noun.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
