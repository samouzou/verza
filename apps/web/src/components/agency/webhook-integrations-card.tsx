"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Webhook, Copy, Check, RefreshCw, Loader2, Store, CreditCard, ChevronDown } from 'lucide-react';
import type { Agency } from '@/types';
import { doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface WebhookIntegrationsCardProps {
  agency: Agency;
  disabled?: boolean;
  isBrandAccount?: boolean;
}

export function WebhookIntegrationsCard({ agency, disabled, isBrandAccount }: WebhookIntegrationsCardProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const webhookUrl = `${process.env.NEXT_PUBLIC_CONVERSION_WEBHOOK_URL}?agencyId=${agency.id}`;
  const stripeBase = process.env.NEXT_PUBLIC_STRIPE_CONVERSION_WEBHOOK_URL ||
    (process.env.NEXT_PUBLIC_CONVERSION_WEBHOOK_URL || '').replace(/conversion(w)ebhook/i, (_m, w: string) =>
      w === 'W' ? 'stripeConversionWebhook' : 'stripeconversionwebhook');
  const stripeWebhookUrl = `${stripeBase}?agencyId=${agency.id}`;
  const stripe = agency.stripeConversions;
  const [copiedStripeUrl, setCopiedStripeUrl] = useState(false);
  const [signingSecret, setSigningSecret] = useState('');
  const [restrictedKey, setRestrictedKey] = useState('');
  const [savingStripe, setSavingStripe] = useState<'save' | 'disconnect' | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(localStorage.getItem('verza.agency.webhooksOpen') === '1');
  }, []);

  const handleCopyStripeUrl = () => {
    navigator.clipboard.writeText(stripeWebhookUrl);
    setCopiedStripeUrl(true);
    toast({ title: "Stripe endpoint copied!" });
    setTimeout(() => setCopiedStripeUrl(false), 2000);
  };

  const saveStripe = async (disconnect = false) => {
    setSavingStripe(disconnect ? 'disconnect' : 'save');
    try {
      const res = await httpsCallable<object, { connected: boolean; promoCodes: boolean }>(
        functions, 'saveStripeConversionSettings',
      )(disconnect ? { agencyId: agency.id, disconnect: true } : { agencyId: agency.id, signingSecret, restrictedKey });
      setSigningSecret('');
      setRestrictedKey('');
      toast({
        title: disconnect ? 'Stripe disconnected' : 'Stripe connected',
        description: disconnect
          ? 'Verza will ignore events from your Stripe account.'
          : res.data.promoCodes
            ? 'Purchases through creator links and creator promo codes will now count.'
            : 'Purchases through creator links will now count. Add a restricted key to also match promo codes.',
      });
    } catch (error: any) {
      toast({ title: 'Could not save Stripe settings', description: error.message, variant: 'destructive' });
    } finally {
      setSavingStripe(null);
    }
  };

  const stripeTime = (t: unknown) => {
    const d = (t as { toDate?: () => Date } | undefined)?.toDate?.();
    return d ? d.toLocaleString() : null;
  };

  const handleCopyUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    toast({ title: "Webhook URL Copied!" });
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopySecret = () => {
    if (!agency.webhookSecret) return;
    navigator.clipboard.writeText(agency.webhookSecret);
    setCopiedSecret(true);
    toast({ title: "Secret Copied!" });
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleGenerateSecret = async () => {
    setIsGenerating(true);
    try {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      const newSecret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

      await updateDoc(doc(db, 'agencies', agency.id), {
        webhookSecret: newSecret
      });

      toast({ title: "Secret Generated!", description: "Ensure you update your e-commerce platform with the new secret." });
    } catch (error: any) {
      toast({ title: "Error Details", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        localStorage.setItem('verza.agency.webhooksOpen', next ? '1' : '0');
      }}
      className={disabled ? 'pointer-events-none opacity-50' : undefined}
    >
    <Card className="border-blue-500/20 bg-blue-50/5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-lg p-6 text-left hover:bg-muted/40 [&[data-state=open]>svg.chevron]:rotate-180"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Webhook className="h-5 w-5 text-blue-500" /> Webhook Integrations
              {stripe?.connected ? (
                <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15">Stripe connected</Badge>
              ) : (
                <Badge variant="outline">Stripe not connected</Badge>
              )}
            </CardTitle>
            <CardDescription>Track conversions from your e-commerce platform using our API.</CardDescription>
          </div>
          <ChevronDown className="chevron mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Endpoint URL</Label>
          <div className="flex items-center gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-xs bg-muted/50" />
            <Button size="icon" variant="outline" onClick={handleCopyUrl}>
              {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Configure Shopify or WooCommerce to send POST requests to this URL on order creation.</p>
        </div>

        <div className="space-y-2">
          <Label>Webhook Secret</Label>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={agency.webhookSecret || 'Not generated yet'}
              readOnly
              className="font-mono text-xs bg-muted/50"
            />
            {agency.webhookSecret && (
              <Button size="icon" variant="outline" onClick={handleCopySecret}>
                {copiedSecret ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            )}
            <Button size="icon" variant="outline" onClick={handleGenerateSecret} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Used to sign webhook payloads. Keep this safe and do not expose it.</p>
        </div>

        <div className="pt-4 border-t border-border/50">
          <Label className="text-sm font-semibold mb-2 block flex items-center gap-2">
            <Store className="h-4 w-4" /> Integration Guides
          </Label>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="shopify">
              <AccordionTrigger className="text-xs font-medium py-3">Shopify Integration</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground space-y-2">
                <ol className="list-decimal pl-4 space-y-1">
                  <li>In your Shopify Admin, go to <strong>Settings</strong> &gt; <strong>Notifications</strong>.</li>
                  <li>Scroll down to Webhooks and click <strong>Create webhook</strong>.</li>
                  <li>Set Event to <strong>Order creation</strong> and Format to <strong>JSON</strong>.</li>
                  <li>Paste your Verza Endpoint URL in the URL field.</li>
                  <li>Select the Latest Webhook API Version and <strong>Save</strong>.</li>
                  <li>Note: Make sure your Verza Promo Codes match your active Shopify Discount Codes!</li>
                </ol>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="woocommerce">
              <AccordionTrigger className="text-xs font-medium py-3">WooCommerce Integration</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground space-y-2">
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Go to <strong>WooCommerce</strong> &gt; <strong>Settings</strong> &gt; <strong>Advanced</strong> &gt; <strong>Webhooks</strong>.</li>
                  <li>Click <strong>Add webhook</strong>.</li>
                  <li>Set Status to <strong>Active</strong> and Topic to <strong>Order created</strong>.</li>
                  <li>Paste your Verza Endpoint URL in the <strong>Delivery URL</strong> field.</li>
                  <li>Paste your generated Verza Webhook Secret (above) into the <strong>Secret</strong> field.</li>
                  <li>Select up to date API Version and click <strong>Save Webhook</strong>.</li>
                </ol>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="stripe">
              <AccordionTrigger className="text-xs font-medium py-3">Stripe Integration</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground space-y-3">
                <p>Stripe uses its own endpoint and signing secret. Set it up in the <strong>Stripe</strong> section below.</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>In your Stripe Dashboard, go to <strong>Developers</strong> &gt; <strong>Webhooks</strong> and click <strong>Add endpoint</strong> (or <strong>Add destination</strong>, then choose <strong>Webhook endpoint</strong>).</li>
                  <li>Paste your <strong>Stripe endpoint URL</strong> from below.</li>
                  <li>Select the event <strong>checkout.session.completed</strong>. If you create customers at signup, also add <strong>customer.created</strong>.</li>
                  <li>Save, then open the endpoint and click <strong>Reveal</strong> under <strong>Signing secret</strong>. It starts with <code>whsec_</code>.</li>
                  <li>Paste the signing secret below and click <strong>Connect Stripe</strong>.</li>
                  <li>Optional, to match creator promo codes: go to <strong>Developers</strong> &gt; <strong>API keys</strong> &gt; <strong>Create restricted key</strong>, give it <strong>Read</strong> access to <strong>Promotion Codes</strong> only, and paste it below. Your Verza promo codes must match your Stripe promotion codes.</li>
                </ol>
                <p className="font-medium text-foreground">How sales are matched to creators</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Stripe Payment Links</strong> (buy.stripe.com): automatic. Use your Payment Link as the campaign destination URL and Verza passes the creator&apos;s link through.</li>
                  <li><strong>Your own checkout</strong>: Verza adds <code>verza_ref</code> to your destination URL. Pass that value to Stripe as <code>client_reference_id</code> (or <code>metadata.verza_ref</code>) when you create the Checkout Session.</li>
                  <li><strong>Free signups</strong>: set <code>metadata.verza_ref</code> when you create the Stripe customer and subscribe to <strong>customer.created</strong>.</li>
                  <li><strong>Promo codes</strong>: a completed checkout using a creator&apos;s promotion code counts once a restricted key is saved.</li>
                </ul>
                <p>Each Stripe customer counts once, so renewals and repeat purchases don&apos;t pay out twice.</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="pt-4 border-t border-border/50 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Stripe
            </Label>
            <div className="flex items-center gap-2">
              {stripe?.connected ? (
                <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15">Connected</Badge>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
              {stripe?.connected && (
                <Badge variant="outline">{stripe.promoCodes ? 'Promo codes on' : 'Links only'}</Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Stripe endpoint URL</Label>
            <div className="flex items-center gap-2">
              <Input value={stripeWebhookUrl} readOnly className="font-mono text-xs bg-muted/50" />
              <Button size="icon" variant="outline" onClick={handleCopyStripeUrl}>
                {copiedStripeUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Add this in Stripe under Developers &gt; Webhooks with the event checkout.session.completed. See the Stripe guide above.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stripe-signing-secret">Signing secret</Label>
            <Input
              id="stripe-signing-secret"
              type="password"
              autoComplete="off"
              placeholder={stripe?.connected ? 'Saved. Paste a new one to replace it.' : 'whsec_...'}
              value={signingSecret}
              onChange={(e) => setSigningSecret(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="stripe-restricted-key">Restricted key (optional, for promo codes)</Label>
            <Input
              id="stripe-restricted-key"
              type="password"
              autoComplete="off"
              placeholder={stripe?.promoCodes ? 'Saved. Paste a new one to replace it.' : 'rk_live_...'}
              value={restrictedKey}
              onChange={(e) => setRestrictedKey(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Read access to Promotion Codes only. Never paste your secret key (sk_). Verza stores these privately and never shows them again.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveStripe(false)}
              disabled={savingStripe !== null || (!signingSecret.trim() && !restrictedKey.trim()) ||
                (!stripe?.connected && !signingSecret.trim())}
            >
              {savingStripe === 'save' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {stripe?.connected ? 'Save' : 'Connect Stripe'}
            </Button>
            {stripe?.connected && (
              <Button size="sm" variant="outline" onClick={() => saveStripe(true)} disabled={savingStripe !== null}>
                {savingStripe === 'disconnect' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Disconnect
              </Button>
            )}
          </div>

          {stripe?.connected && (
            <p className="text-[10px] text-muted-foreground">
              {stripeTime(stripe.lastEventAt)
                ? `Last event from Stripe: ${stripeTime(stripe.lastEventAt)}.`
                : 'No events received yet. Complete a test checkout to check the connection.'}
              {stripeTime(stripe.lastConversionAt) && ` Last creator conversion: ${stripeTime(stripe.lastConversionAt)}.`}
            </p>
          )}
        </div>
      </CardContent>
      </CollapsibleContent>
    </Card>
    </Collapsible>
  );
}
