"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import type { OpticJobRow } from "@/lib/optic/types";

function notifyBrowser(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

export function useOpticActiveJob(activeJobId: string | null) {
  const { toast } = useToast();
  const router = useRouter();
  const [jobRow, setJobRow] = useState<OpticJobRow | null>(null);
  const [listenError, setListenError] = useState<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeJobId) {
      setJobRow(null);
      setListenError(null);
      prevStatusRef.current = null;
      return;
    }
    const ref = doc(db, "optic_jobs", activeJobId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setListenError(null);
        if (!snap.exists()) {
          setJobRow(null);
          return;
        }
        setJobRow({ id: snap.id, ...(snap.data() as Omit<OpticJobRow, "id">) });
      },
      (err) => {
        setListenError(err.message);
      }
    );
    return () => unsub();
  }, [activeJobId]);

  useEffect(() => {
    const status = jobRow?.status;
    if (!status || !activeJobId) return;
    const prev = prevStatusRef.current;
    if (prev === status) return;

    if (prev && status === "completed") {
      const count = jobRow?.processedCount ?? 0;
      toast({
        title: "Verza Optic — mission complete",
        description: `Saved ${count} lead${count === 1 ? "" : "s"} to your vault.`,
      });
      notifyBrowser(
        "Verza Optic",
        `Mission complete — ${count} new lead${count === 1 ? "" : "s"} in the vault.`
      );
    } else if (prev && status === "failed") {
      toast({
        title: "Verza Optic — mission failed",
        description: jobRow?.error ?? "See job logs for details.",
        variant: "destructive",
      });
      notifyBrowser("Verza Optic", "Discovery mission failed.");
    } else if (prev && status === "cancelled") {
      toast({ title: "Mission cancelled" });
    }

    prevStatusRef.current = status;
  }, [jobRow?.status, jobRow?.processedCount, jobRow?.error, activeJobId, toast]);

  const requestNotificationPermission = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  const goToVault = useCallback(() => router.push("/optic/vault"), [router]);

  return { jobRow, listenError, requestNotificationPermission, goToVault };
}
