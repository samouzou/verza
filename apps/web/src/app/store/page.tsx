"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  ShoppingBag,
  AlertTriangle,
  GraduationCap,
  Link2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUpload } from "@/components/ui/image-upload";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import type { StoreProduct, StorePurchase } from "@/types";
import { chapterCount } from "@/lib/store-editor";
import { cn } from "@/lib/utils";

type LinkFormState = {
  title: string;
  description: string;
  priceDollars: string;
  coverImageUrl: string;
  accessUrl: string;
  status: "draft" | "active" | "archived";
};

const emptyLinkForm: LinkFormState = {
  title: "",
  description: "",
  priceDollars: "",
  coverImageUrl: "",
  accessUrl: "",
  status: "draft",
};

function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function StorePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [purchases, setPurchases] = useState<StorePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LinkFormState>(emptyLinkForm);
  const [saving, setSaving] = useState(false);

  const isCreator =
    user?.role === "individual_creator" || user?.role === "talent";
  const connectReady = !!(user?.stripeAccountId && user?.stripePayoutsEnabled);

  const totals = useMemo(() => {
    const sales = products.reduce((n, p) => n + (p.salesCount || 0), 0);
    const revenue = products.reduce((n, p) => n + (p.revenueCents || 0), 0);
    return { sales, revenue };
  }, [products]);

  useEffect(() => {
    if (!user?.uid || !isCreator) {
      setLoading(false);
      return;
    }

    const productsQ = query(
      collection(db, "storeProducts"),
      where("creatorId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const purchasesQ = query(
      collection(db, "storePurchases"),
      where("creatorId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubProducts = onSnapshot(
      productsQ,
      (snap) => {
        setProducts(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as StoreProduct))
        );
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        toast({
          title: "Couldn't load products",
          description: err.message,
          variant: "destructive",
        });
      }
    );

    const unsubPurchases = onSnapshot(
      purchasesQ,
      (snap) => {
        setPurchases(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as StorePurchase))
        );
      },
      (err) => console.error(err)
    );

    return () => {
      unsubProducts();
      unsubPurchases();
    };
  }, [user?.uid, isCreator, toast]);

  const openCreateLink = () => {
    setEditingId(null);
    setForm(emptyLinkForm);
    setDialogOpen(true);
  };

  const openEdit = async (product: StoreProduct) => {
    if ((product.kind || "link") === "course") {
      router.push(`/store/${product.id}/edit`);
      return;
    }
    setEditingId(product.id);
    setForm({
      title: product.title,
      description: product.description || "",
      priceDollars: (product.priceCents / 100).toFixed(2),
      coverImageUrl: product.coverImageUrl || "",
      accessUrl: product.accessUrl || "",
      status: product.status,
    });
    setDialogOpen(true);
    try {
      const getContent = httpsCallable(functions, "getStoreProductContent");
      const result = await getContent({ productId: product.id });
      const data = result.data as { accessUrl?: string | null };
      if (data.accessUrl) {
        setForm((f) => ({ ...f, accessUrl: data.accessUrl || "" }));
      }
    } catch {
      // Public fields still editable
    }
  };

  const handleSave = async () => {
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
    if (!form.accessUrl.trim()) {
      toast({
        title: "Access link required",
        description: "Buyers receive this URL after payment.",
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
        productId: editingId || undefined,
        title: form.title.trim(),
        description: form.description.trim(),
        priceCents: price,
        kind: "link",
        coverImageUrl: form.coverImageUrl.trim() || null,
        accessUrl: form.accessUrl.trim(),
        status: form.status,
      });
      toast({
        title: editingId ? "Product updated" : "Product created",
      });
      setDialogOpen(false);
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

  const copyLink = async (productId: string) => {
    const url = `${window.location.origin}/s/${productId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isCreator) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center space-y-3">
        <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Store is for creators</h1>
        <p className="text-muted-foreground">
          Monetize your audience with digital products. Brand teams use Campaigns
          and Agency tools instead.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Store"
        description="Sell downloads and courses to your audience. Fans pay once; you get paid via your payout account."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push("/store/new?kind=course")}>
              <GraduationCap className="mr-2 h-4 w-4" />
              New course
            </Button>
            <Button onClick={openCreateLink} id="store-create-product">
              <Plus className="mr-2 h-4 w-4" />
              New download
            </Button>
          </div>
        }
      />

      {!connectReady && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Connect payouts to publish</p>
            <p className="text-muted-foreground">
              You can draft products now. Publishing requires an active payout
              account so fan payments can transfer to you.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href="/settings">Open Settings</Link>
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sales</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{totals.sales}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Creator net (after fees)</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatUsd(totals.revenue)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Products</h2>
        {products.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No products yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Sell a download, invite link, or a multi-lesson course. Share the
                product URL anywhere your audience already is.
              </p>
              <Button onClick={openCreateLink}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first product
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                {product.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.coverImageUrl}
                    alt=""
                    className="h-36 w-full object-cover"
                  />
                )}
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-lg leading-snug">
                        {product.title}
                      </CardTitle>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="gap-1 font-normal">
                          {(product.kind || "link") === "course" ? (
                            <GraduationCap className="h-3 w-3" />
                          ) : (
                            <Link2 className="h-3 w-3" />
                          )}
                          {(product.kind || "link") === "course"
                            ? `Course · ${chapterCount(product)} chapters`
                            : "Download / link"}
                        </Badge>
                      </div>
                    </div>
                    <Badge
                      variant={
                        product.status === "active" ? "default" : "secondary"
                      }
                      className={cn(
                        product.status === "active" &&
                          "bg-emerald-600 hover:bg-emerald-600"
                      )}
                    >
                      {product.status}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {product.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold tabular-nums">
                      {formatUsd(product.priceCents)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {product.salesCount || 0} sold ·{" "}
                      {formatUsd(product.revenueCents || 0)} net
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(product)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyLink(product.id)}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy link
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a
                        href={`/s/${product.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Preview
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Recent sales</h2>
        {purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sales will show here after your first purchase.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium">Buyer</th>
                  <th className="px-4 py-2 font-medium text-right">You received</th>
                </tr>
              </thead>
              <tbody>
                {purchases.slice(0, 20).map((sale) => (
                  <tr key={sale.id} className="border-t">
                    <td className="px-4 py-2.5">{sale.productTitle}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {sale.buyerEmail}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatUsd(sale.creatorNetCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit download" : "New download"}
            </DialogTitle>
            <DialogDescription>
              One-time purchase. After payment, buyers get your access link by
              email (10% Verza fee + card processing).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cover image</Label>
              {user?.uid && (
                <ImageUpload
                  value={form.coverImageUrl || undefined}
                  folder={`store/${user.uid}/covers`}
                  label="Upload cover"
                  onChange={(url) =>
                    setForm((f) => ({ ...f, coverImageUrl: url }))
                  }
                  onRemove={() =>
                    setForm((f) => ({ ...f, coverImageUrl: "" }))
                  }
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="store-title">Title</Label>
              <Input
                id="store-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="Creator pack, Discord invite…"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="store-description">Description</Label>
              <Textarea
                id="store-description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="What buyers get"
                rows={3}
                maxLength={2000}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="store-price">Price (USD)</Label>
                <Input
                  id="store-price"
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.priceDollars}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priceDollars: e.target.value }))
                  }
                  placeholder="29.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v: LinkFormState["status"]) =>
                    setForm((f) => ({ ...f, status: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active" disabled={!connectReady}>
                      Active {connectReady ? "" : "(needs Connect)"}
                    </SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="store-access">Access / delivery link</Label>
              <Input
                id="store-access"
                value={form.accessUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, accessUrl: e.target.value }))
                }
                placeholder="https://…"
              />
              <p className="text-xs text-muted-foreground">
                Kept private until purchase. Buyers unlock it by email after
                paying.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
