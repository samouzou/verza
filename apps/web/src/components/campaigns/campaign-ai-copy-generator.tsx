"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import type { Gig } from "@/types";

function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

function parseOptionalMoney(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export type CampaignAiCopyGeneratorProps = {
  campaignType: Gig["campaignType"];
  platforms: string[];
  disabled?: boolean;
  isSubmitting?: boolean;
  /** When set, passed to the model as optional pay context (USD per creator). */
  ratePerCreator?: string;
  creatorsNeeded?: string;
  videosPerCreator?: string;
  affiliateEnabled?: boolean;
  onApply: (title: string, descriptionHtml: string) => void;
};

/**
 * Optional brief + button to call `generateCampaignCopy` and fill title + rich-text brief.
 */
export function CampaignAiCopyGenerator({
  campaignType,
  platforms,
  disabled,
  isSubmitting,
  ratePerCreator,
  creatorsNeeded,
  videosPerCreator,
  affiliateEnabled,
  onApply,
}: CampaignAiCopyGeneratorProps) {
  const { toast } = useToast();
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);

  const busy = Boolean(disabled || isSubmitting || loading);

  const handleGenerate = async () => {
    const userPrompt = hint.trim();
    if (!userPrompt) {
      toast({
        variant: "destructive",
        title: "Add a short brief",
        description: "Describe the product, cause, or what you want creators to do — then generate.",
      });
      return;
    }

    setLoading(true);
    try {
      const callable = httpsCallable(functions, "generateCampaignCopy");
      const res = await callable({
        campaignType,
        userPrompt,
        platforms,
        ratePerCreator: parseOptionalMoney(ratePerCreator),
        creatorsNeeded: parseOptionalPositiveInt(creatorsNeeded),
        videosPerCreator: parseOptionalPositiveInt(videosPerCreator),
        affiliateEnabled: Boolean(affiliateEnabled),
      });
      const data = res.data as { title?: string; descriptionHtml?: string };
      const title = typeof data.title === "string" ? data.title.trim() : "";
      const descriptionHtml =
        typeof data.descriptionHtml === "string" ? data.descriptionHtml.trim() : "";
      if (!title || !descriptionHtml) {
        throw new Error("Empty response");
      }
      onApply(title, descriptionHtml);
      toast({
        title: "Draft ready",
        description: "Review the title and brief, then tweak as needed before publishing.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed.";
      toast({ variant: "destructive", title: "AI draft", description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-medium">AI draft assistant</p>
        <span className="text-xs text-muted-foreground">
          Uses your campaign type ({campaignType.replace(/_/g, " ")}) so paid, cause, grant, and barter
          briefs read correctly.
        </span>
      </div>
      <div className="space-y-2">
        <Label htmlFor="campaign-ai-hint">What should this campaign cover?</Label>
        <Textarea
          id="campaign-ai-hint"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="e.g. Nonprofit river cleanup weekend — creators share one Reel + link to volunteer signup; no paid fee."
          rows={3}
          disabled={busy}
          maxLength={4000}
          className="resize-y min-h-[80px]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleGenerate} disabled={busy}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate title &amp; brief
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Fills campaign title and brief below — you stay in control of rates, legal options, and publish.
        </p>
      </div>
    </div>
  );
}
