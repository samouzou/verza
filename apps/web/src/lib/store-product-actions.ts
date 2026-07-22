"use client";

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { StoreProductStatus } from "@/types";

export type ManageStoreProductAction = "archive" | "restore" | "delete";

export async function manageStoreProduct(
  productId: string,
  action: ManageStoreProductAction
): Promise<{ status?: StoreProductStatus; deleted?: boolean }> {
  const callable = httpsCallable(functions, "manageStoreProduct");
  const res = await callable({ productId, action });
  return res.data as { status?: StoreProductStatus; deleted?: boolean };
}
