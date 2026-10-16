"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { Megaphone, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Agency, Gig, GigSubmission } from '@/types';

const COUNTRIES: Array<[string, string]> = [
  ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia'],
  ['DE', 'Germany'], ['FR', 'France'], ['MX', 'Mexico'], ['BR', 'Brazil'],
];

const STATUS_LABEL: Record<NonNullable<GigSubmission['metaAd']>['status'], string> = {
  creating: 'Sending the video to Meta',
  processing: 'Meta is processing the video',
  in_review: 'In Meta review',
  active: 'Running',
  paused: 'Paused',
  rejected: 'Rejected by Meta',
  error: 'Needs attention',
};

/**
 * Launches and checks the Meta ad for one approved submission.
 * Shown to the brand on the campaign roster.
 */
export function SubmissionMetaAd({ submission, gig }: { submission: GigSubmission; gig: Gig }) {
  const { toast } = useToast();
  const ad = submission.metaAd;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [budget, setBudget] = useState('20');
  const [days, setDays] = useState('7');
  const [country, setCountry] = useState('US');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getDoc(doc(db, 'agencies', gig.brandId)).then((snap) => {
      if (!active) return;
      const meta = snap.data()?.metaAds as Agency['metaAds'];
      setConnected(Boolean(meta?.connected));
      if (meta?.currency) setCurrency(meta.currency);
    }).catch(() => active && setConnected(false));
    return () => { active = false; };
  }, [gig.brandId]);

  useEffect(() => {
    if (ad?.status !== 'processing' && ad?.status !== 'creating') return;
    const timer = setInterval(() => {
      httpsCallable(functions, 'continueSubmissionAd')({ submissionId: submission.id }).catch(() => undefined);
    }, 8000);
    return () => clearInterval(timer);
  }, [ad?.status, submission.id]);

  const fail = (error: unknown) => {
    const text = error instanceof Error ? error.message : 'Meta could not update this ad.';
    toast({ title: 'Meta ad', description: text, variant: 'destructive' });
  };

  const launch = async () => {
    setBusy(true);
    try {
      await httpsCallable(functions, ad?.videoId ? 'continueSubmissionAd' : 'launchSubmissionAd')(
        ad?.videoId ? { submissionId: submission.id } : {
          submissionId: submission.id,
          dailyBudget: Number(budget),
          days: Number(days),
          country,
          message,
        },
      );
      toast({ title: ad?.videoId ? 'Checking the ad' : 'Ad sent to Meta', description: 'Meta reviews new ads before they run.' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'PAUSED') => {
    setBusy(true);
    try {
      await httpsCallable(functions, 'setSubmissionAdStatus')({ submissionId: submission.id, status });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      await httpsCallable(functions, 'continueSubmissionAd')({ submissionId: submission.id });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  if (submission.status !== 'approved') return null;
  const rights = gig.usageRights || '1_year';
  if (rights === 'none') return null;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-semibold flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Meta ad</p>
      {connected === false && (
        <p className="text-xs text-muted-foreground">
          <Link href="/agency" className="underline">Connect Meta</Link> on the Agency page to run this video as an ad.
        </p>
      )}
      {connected && !ad?.adId && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Daily budget ({currency})</Label>
              <Input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Days</Label>
              <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Country</Label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
          </div>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ad text (optional)" className="h-8 text-xs" />
          <Button size="sm" className="h-8" onClick={launch} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {ad?.videoId ? 'Finish setup' : 'Run as ad'}
          </Button>
        </div>
      )}
      {ad && (
        <div className="space-y-1.5">
          <p className="text-xs">{STATUS_LABEL[ad.status]}{ad.effectiveStatus ? ` · ${ad.effectiveStatus}` : ''}</p>
          {ad.adId && (
            <p className="text-xs text-muted-foreground">
              Spent {ad.spend?.toLocaleString(undefined, { style: 'currency', currency: ad.currency || currency }) ?? '—'}
              {' · '}{ad.impressions?.toLocaleString() ?? 0} impressions
              {' · '}{ad.clicks?.toLocaleString() ?? 0} link clicks
            </p>
          )}
          {ad.error && <p className="text-xs text-destructive">{ad.error}</p>}
          {ad.adId && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus(ad.status === 'paused' ? 'ACTIVE' : 'PAUSED')} disabled={busy}>
                {ad.status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={refresh} disabled={busy}>Refresh</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
