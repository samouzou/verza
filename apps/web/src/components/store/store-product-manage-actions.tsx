"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { manageStoreProduct } from "@/lib/store-product-actions";
import type { StoreProductStatus } from "@/types";

type PendingAction = "archive" | "restore" | "delete" | null;

type StoreProductManageActionsProps = {
  productId: string;
  status: StoreProductStatus;
  salesCount?: number;
  /** After archive/restore — optional callback */
  onStatusChange?: (status: StoreProductStatus) => void;
  /** After delete — defaults to navigating to /store */
  onDeleted?: () => void;
  /** menu = compact ⋯ trigger; panel = full-width buttons */
  variant?: "menu" | "panel";
};

export function StoreProductManageActions({
  productId,
  status,
  salesCount = 0,
  onStatusChange,
  onDeleted,
  variant = "menu",
}: StoreProductManageActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingAction>(null);
  const [loading, setLoading] = useState(false);

  const canDelete = salesCount === 0;
  const isArchived = status === "archived";

  const runAction = async (action: NonNullable<PendingAction>) => {
    setLoading(true);
    try {
      const result = await manageStoreProduct(productId, action);
      if (action === "delete") {
        toast({ title: "Product deleted" });
        if (onDeleted) onDeleted();
        else router.push("/store");
        return;
      }
      const nextStatus = result.status || (action === "archive" ? "archived" : "draft");
      toast({
        title: action === "archive" ? "Product archived" : "Restored to draft",
        description:
          action === "archive"
            ? "Hidden from your storefront. Buyers who already purchased keep access."
            : "Edit and publish again when ready.",
      });
      onStatusChange?.(nextStatus);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Action failed.";
      toast({ variant: "destructive", title: "Couldn't update product", description: message });
    } finally {
      setLoading(false);
      setPending(null);
    }
  };

  const triggerArchive = () => setPending("archive");
  const triggerRestore = () => setPending("restore");
  const triggerDelete = () => setPending("delete");

  const dialogCopy = {
    archive: {
      title: "Archive this product?",
      description:
        "It will be hidden from your public store and checkout. Anyone who already bought it can still access their purchase.",
    },
    restore: {
      title: "Restore to draft?",
      description:
        "The product returns to draft. Set status to Active when you're ready to sell again.",
    },
    delete: {
      title: "Delete permanently?",
      description:
        "This removes the product and its private content. This cannot be undone.",
    },
  };

  return (
    <>
      {variant === "menu" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Product actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isArchived ? (
              <DropdownMenuItem onClick={triggerRestore}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore to draft
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={triggerArchive}>
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={triggerDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="rounded-lg border border-dashed p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Archive or delete</p>
            <p className="text-xs text-muted-foreground mt-1">
              Archive hides the product from sale. Delete is only available with
              zero sales.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isArchived ? (
              <Button variant="outline" size="sm" onClick={triggerRestore} disabled={loading}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore to draft
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={triggerArchive} disabled={loading}>
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={triggerDelete}
                disabled={loading}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
          {!canDelete && (
            <p className="text-xs text-muted-foreground">
              {salesCount} sale{salesCount === 1 ? "" : "s"} — use Archive instead of delete.
            </p>
          )}
        </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialogCopy[pending].title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {dialogCopy[pending].description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={loading}
                  className={
                    pending === "delete"
                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : undefined
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    if (pending) runAction(pending);
                  }}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {pending === "delete"
                    ? "Delete"
                    : pending === "archive"
                      ? "Archive"
                      : "Restore"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
