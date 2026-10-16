"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Loader2 } from 'lucide-react';
import type { Agency } from '@/types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

interface MetaAdsCardProps {
  agency: Agency;
  disabled?: boolean;
}

interface AdAccount { id: string; name: string; currency: string }
interface PageOption { id: string; name: string; instagramId: string | null; instagramUsername: string | null }

/**
 * Connects the workspace's Meta ad account so approved creator videos can run as ads.
 * The token stays in a server-only document.
 */
export function MetaAdsCard({ agency, disabled }: MetaAdsCardProps) {
  const { toast } = useToast();
  const meta = agency.metaAds;
  const [busy, setBusy] = useState<'connect' | 'save' | 'disconnect' | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [adAccountId, setAdAccountId] = useState('');
  const [pageId, setPageId] = useState('');

  const finishConnect = async (accessToken: string) => {
    setBusy('connect');
    try {
      const res = await httpsCallable<object, { adAccounts: AdAccount[]; pages: PageOption[] }>(
        functions, 'connectMetaAds',
      )({ agencyId: agency.id, accessToken });
      setAccounts(res.data.adAccounts);
      setPages(res.data.pages);
      setAdAccountId(res.data.adAccounts[0]?.id ?? '');
      setPageId(res.data.pages[0]?.id ?? '');
      toast({ title: 'Meta connected', description: 'Choose the ad account and Page to advertise from.' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Meta rejected the connection.';
      toast({ title: 'Could not connect Meta', description: message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const connect = () => {
    const FB = (window as unknown as { FB?: { login: (cb: (r: { authResponse?: { accessToken?: string } }) => void, opts: object) => void } }).FB;
    if (!FB) {
      toast({ title: 'Meta is still loading', description: 'Wait a moment and try again.', variant: 'destructive' });
      return;
    }
    FB.login(function (response) {
      const accessToken = response.authResponse?.accessToken;
      if (!accessToken) {
        toast({ title: 'Meta connection canceled' });
        return;
      }
      void finishConnect(accessToken);
    }, {
      scope: 'ads_management,ads_read,pages_show_list,pages_read_engagement,instagram_basic,business_management',
      auth_type: 'rerequest',
    });
  };

  const save = async () => {
    setBusy('save');
    try {
      const res = await httpsCallable<object, { instagram: boolean; adAccountName: string; pageName: string }>(
        functions, 'selectMetaAdsAccount',
      )({ agencyId: agency.id, adAccountId, pageId });
      setAccounts(null);
      setPages(null);
      toast({
        title: 'Ad account saved',
        description: res.data.instagram
          ? `${res.data.adAccountName} will run ads on ${res.data.pageName} and its Instagram.`
          : `${res.data.adAccountName} will run ads on ${res.data.pageName}. Link an Instagram account to that Page to run Instagram ads too.`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not save the ad account.';
      toast({ title: 'Could not save', description: message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await httpsCallable(functions, 'disconnectMetaAds')({ agencyId: agency.id });
      setAccounts(null);
      setPages(null);
      toast({ title: 'Meta disconnected' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not disconnect.';
      toast({ title: 'Could not disconnect', description: message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-blue-500" /> Meta Ads</CardTitle>
          {meta?.connected ? (
            <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15">Connected</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
        <CardDescription>
          Run an approved creator video as an ad from your own Meta ad account. You pay Meta directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {meta?.connected && (
          <p className="text-sm">
            Advertising from <span className="font-medium">{meta.adAccountName}</span> as <span className="font-medium">{meta.pageName}</span>.
          </p>
        )}

        {accounts && pages && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="meta-ad-account">Ad account</Label>
              <select id="meta-ad-account" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meta-page">Facebook Page</Label>
              <select id="meta-page" value={pageId} onChange={(e) => setPageId(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.instagramUsername ? ` · @${p.instagramUsername}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={save} disabled={busy !== null || !adAccountId || !pageId}>
              {busy === 'save' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Use this account
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={meta?.connected ? 'outline' : 'default'} onClick={connect} disabled={busy !== null}>
            {busy === 'connect' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {meta?.connected ? 'Reconnect Meta' : 'Connect Meta'}
          </Button>
          {meta?.connected && (
            <Button size="sm" variant="outline" onClick={disconnect} disabled={busy !== null}>
              {busy === 'disconnect' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disconnect
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Verza stores the connection privately and never shows it again. Ads open from an approved video on a campaign.
          The ad links to that creator&apos;s tracking link, so sales still attribute in Verza.
        </p>
      </CardContent>
    </Card>
  );
}
