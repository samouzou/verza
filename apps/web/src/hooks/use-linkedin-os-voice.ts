"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { LinkedInOsVoiceProfile } from "@/lib/linkedin-os/types";

/**
 * Live subscription to the agency LinkedIn voice profile.
 * @param {string | null} agencyId Primary agency id.
 * @return {{ profile, loading, error }} Voice profile state.
 */
export function useLinkedInOsVoiceProfile(agencyId: string | null) {
  const [profile, setProfile] = useState<LinkedInOsVoiceProfile | null>(null);
  const [loading, setLoading] = useState(!!agencyId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "linkedin_os_voice_profiles", agencyId),
      (snap) => {
        if (!snap.exists()) {
          setProfile(null);
        } else {
          setProfile({ agencyId, ...(snap.data() as Omit<LinkedInOsVoiceProfile, "agencyId">) });
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [agencyId]);

  return { profile, loading, error };
}
