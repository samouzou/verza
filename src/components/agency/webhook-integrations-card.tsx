"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Webhook, Copy, Check, RefreshCw, Loader2 } from 'lucide-react';
import type { Agency } from '@/types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

interface WebhookIntegrationsCardProps {
  agency: Agency;
  disabled?: boolean;
}

export function WebhookIntegrationsCard({ agency, disabled }: WebhookIntegrationsCardProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'verza';
  const webhookUrl = `https://us-central1-${projectId}.cloudfunctions.net/conversionWebhook?agencyId=${agency.id}`;

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
      </CardContent>
    </Card>
  );
}
