"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, ArrowLeft, Globe, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { VoiceProfilePanel } from "@/components/prism/voice-profile-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { usePrismBrand } from "@/hooks/use-prism-brand";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import {
  emptyPrismStrategy,
  normalizePrismStrategy,
  PRISM_CHANNEL_META,
  PRISM_CHANNELS,
  type PrismBrandStrategy,
  type PrismChannel,
  type PrismChannelPlan,
  type PrismPillar,
} from "@/lib/prism/types";

const MAX_PILLARS = 6;

export default function PrismSetupPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const { toast } = useToast();
  const agencyId = user?.primaryAgencyId ?? null;
  const { strategy, loading } = usePrismBrand(agencyId);

  const [form, setForm] = useState<PrismBrandStrategy>(() => emptyPrismStrategy());
  const [hydrated, setHydrated] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading || hydrated) return;
    if (strategy) setForm(strategy);
    setHydrated(true);
  }, [loading, strategy, hydrated]);

  const patch = (p: Partial<PrismBrandStrategy>) => setForm((f) => ({ ...f, ...p }));
  const patchChannel = (ch: PrismChannel, p: Partial<PrismChannelPlan>) =>
    setForm((f) => ({ ...f, channels: { ...f.channels, [ch]: { ...f.channels[ch], ...p } } }));
  const patchPillar = (i: number, p: Partial<PrismPillar>) =>
    setForm((f) => ({ ...f, pillars: f.pillars.map((row, j) => (j === i ? { ...row, ...p } : row)) }));

  const shareTotal = form.pillars.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
  const postsPerWeek = PRISM_CHANNELS.reduce(
    (sum, ch) => sum + (form.channels[ch].enabled ? form.channels[ch].postsPerWeek : 0),
    0
  );

  const handleDraft = async () => {
    if (!form.websiteUrl.trim()) {
      toast({ title: "Add your website first", variant: "destructive" });
      return;
    }
    setDrafting(true);
    try {
      const draft = httpsCallable(functions, "draftPrismBrandStrategy");
      const res = await draft({ websiteUrl: form.websiteUrl.trim() });
      const data = res.data as { strategy?: Partial<PrismBrandStrategy> };
      if (!data.strategy) throw new Error("No draft came back.");
      setForm((f) => ({
        ...normalizePrismStrategy(data.strategy),
        timezone: f.timezone,
        approvalRequired: f.approvalRequired,
      }));
      toast({ title: "Draft ready", description: "Review every field, then save." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not draft a setup.";
      toast({ title: "Draft failed", description: msg, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const save = httpsCallable(functions, "savePrismBrandStrategy");
      await save({ strategy: form });
      toast({ title: "Brand setup saved", description: "Plans and drafts now use this setup." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save.";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (agencyId && loading)) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !isAgencyTeam || !agencyId) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Agency account required</AlertTitle>
          <AlertDescription>
            Prism is for agency team members with a primary agency. Sign in with your agency account or
            complete onboarding first.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-16 max-w-4xl">
      <PageHeader
        title="Brand setup"
        description="What Prism knows about your brand. Every plan and draft is grounded in this."
        actions={
          <Button variant="outline" asChild>
            <Link href="/prism">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Prism
            </Link>
          </Button>
        }
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Start from your website
          </CardTitle>
          <CardDescription>
            Prism reads your homepage and Brand Guide, then drafts your brief, pillars, and channel plan. You
            review before anything is saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={form.websiteUrl}
            onChange={(e) => patch({ websiteUrl: e.target.value })}
            placeholder="yourbrand.com"
            className="sm:max-w-sm"
          />
          <Button type="button" onClick={() => void handleDraft()} disabled={drafting}>
            {drafting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {drafting ? "Reading your site…" : strategy ? "Redraft from website" : "Draft my setup"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand</CardTitle>
          <CardDescription>Facts Prism may use. Anything not here, it won&apos;t claim.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input id="brand-name" value={form.brandName} onChange={(e) => patch({ brandName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-brief">Brief</Label>
            <Textarea
              id="brand-brief"
              rows={6}
              value={form.brief}
              onChange={(e) => patch({ brief: e.target.value.slice(0, 6000) })}
              placeholder="What you sell, to whom, why you're different, proof points you can stand behind."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-audience">Audience</Label>
            <Textarea
              id="brand-audience"
              rows={3}
              value={form.audience}
              onChange={(e) => patch({ audience: e.target.value.slice(0, 2000) })}
              placeholder="Who you're talking to and what they care about."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Content pillars</CardTitle>
              <CardDescription>
                3–5 themes you&apos;ll be known for. Shares guide how often each shows up in a week.
              </CardDescription>
            </div>
            <Badge variant={shareTotal === 100 ? "secondary" : "outline"}>{shareTotal}% of posts</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.pillars.length === 0 && (
            <p className="text-sm text-muted-foreground">No pillars yet. Draft from your website or add one.</p>
          )}
          {form.pillars.map((p, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={p.label}
                  onChange={(e) => patchPillar(i, { label: e.target.value.slice(0, 60) })}
                  placeholder="Pillar name"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="w-20"
                    value={p.share}
                    onChange={(e) => patchPillar(i, { share: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove pillar"
                  onClick={() => patch({ pillars: form.pillars.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Input
                value={p.description}
                onChange={(e) => patchPillar(i, { description: e.target.value.slice(0, 300) })}
                placeholder="What this pillar covers"
              />
            </div>
          ))}
          {form.pillars.length < MAX_PILLARS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => patch({ pillars: [...form.pillars, { id: "", label: "", description: "", share: 0 }] })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add pillar
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Channels</CardTitle>
              <CardDescription>
                Give each channel a job. Prism plans native formats per channel, not one post copied everywhere.
              </CardDescription>
            </div>
            <Badge variant="outline">{postsPerWeek} posts / week</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {PRISM_CHANNELS.map((ch) => {
            const c = form.channels[ch];
            return (
              <div key={ch} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Switch checked={c.enabled} onCheckedChange={(v) => patchChannel(ch, { enabled: v })} />
                    <Badge variant="outline" className={PRISM_CHANNEL_META[ch].chip}>
                      {PRISM_CHANNEL_META[ch].label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={14}
                      className="w-20"
                      disabled={!c.enabled}
                      value={c.postsPerWeek}
                      onChange={(e) =>
                        patchChannel(ch, { postsPerWeek: Math.max(0, Math.min(14, Number(e.target.value) || 0)) })
                      }
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">/ week</span>
                  </div>
                </div>
                {c.enabled && (
                  <Input
                    value={c.role}
                    onChange={(e) => patchChannel(ch, { role: e.target.value.slice(0, 200) })}
                    placeholder="This channel's job, e.g. thought leadership for buyers"
                  />
                )}
              </div>
            );
          })}
          {postsPerWeek > 12 && (
            <p className="text-xs text-muted-foreground">
              Weekly plans cap at 12 posts, so Prism will scale channels down proportionally.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guardrails</CardTitle>
          <CardDescription>What Prism must never say, and how posts get signed off.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="banned">Never say</Label>
            <Textarea
              id="banned"
              rows={4}
              value={form.bannedClaims}
              onChange={(e) => patch({ bannedClaims: e.target.value.slice(0, 3000) })}
              placeholder={"One per line, e.g.\nGuaranteed results\nNamed competitors\nUnreleased features"}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Require approval before posting</p>
              <p className="text-xs text-muted-foreground">Drafts stay drafts until a teammate approves them.</p>
            </div>
            <Switch checked={form.approvalRequired} onCheckedChange={(v) => patch({ approvalRequired: v })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tz">Timezone</Label>
            <Input
              id="tz"
              value={form.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              className="max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save brand setup
        </Button>
      </div>

      <VoiceProfilePanel agencyId={agencyId} />
    </div>
  );
}
