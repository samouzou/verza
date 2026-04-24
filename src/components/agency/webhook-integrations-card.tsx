"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Webhook, Copy, Check, RefreshCw, Loader2, Store } from 'lucide-react';
import type { Agency } from '@/types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface WebhookIntegrationsCardProps {
  agency: Agency;
  disabled?: boolean;
}

export function WebhookIntegrationsCard({ agency, disabled }: WebhookIntegrationsCardProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const webhookUrl = `https://conversionwebhook-cpmccwbluq-uc.a.run.app?agencyId=${agency.id}`;

  const handleCopyUrl = () => {
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
    <Card className={`border-blue-500/20 bg-blue-50/5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5 text-blue-500" /> Webhook Integrations</CardTitle>
        <CardDescription>Track conversions from your e-commerce platform using our API.</CardDescription>
      </CardHeader>
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
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}
