
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Lightbulb, Zap, ShieldCheck, Flame, Trophy, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type CoPilotContext = 'browse' | 'post' | 'details_brand' | 'details_creator';

interface Tip {
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: string;
}

const TIPS: Record<CoPilotContext, Tip[]> = {
  browse: [
    {
      icon: ShieldCheck,
      title: "Verified Edge",
      description: "Creators with connected social accounts get 3x more gig acceptances from brands.",
      badge: "PRO TIP"
    },
    {
      icon: Flame,
      title: "The Verza Score",
      description: "Brands prioritize creators who consistently hit 65%+ on The Gauntlet. Higher scores = higher rates.",
    },
    {
      icon: Trophy,
      title: "Winning Hooks",
      description: "Use Scene Spawner to iterate on your first 3 seconds. The hook determines your Verza Score.",
    }
  ],
  post: [
    {
      icon: Zap,
      title: "Hook Over Specs",
      description: "UGC success depends on the first 1.5 seconds. Ask creators for 'pattern interrupt' hooks.",
      badge: "STRATEGY"
    },
    {
      icon: Lock,
      title: "Campaign Vault",
      description: "Your funds are held securely in the campaign vault and only released when you approve verified submissions.",
    },
    {
      icon: Flame,
      title: "The Quality Gate",
      description: "The Verza Score acts as your quality gate. Only pay for content that actually passes our engagement simulation.",
    }
  ],
  details_brand: [
    {
      icon: Sparkles,
      title: "One-Click Agreements",
      description: "Use the AI generator to create a fair UGC agreement instantly. Don't let legal slow you down.",
      badge: "EFFICIENCY"
    },
    {
      icon: Zap,
      title: "Reviewing Scores",
      description: "Check the 'Verza Score' feedback. It simulates 10k Gen Z scrollers so you don't have to guess.",
    }
  ],
  details_creator: [
    {
      icon: Lock,
      title: "Pre-Funded Gigs",
      description: "The brand has already funded this gig. Your payment is waiting in the vault and is released upon approval.",
      badge: "SECURE"
    },
    {
      icon: Flame,
      title: "Hit the 65%",
      description: "You can re-upload videos until you pass the Verza Score. Focus on pacing and visual aesthetic.",
    },
    {
      icon: Zap,
      title: "Direct Release",
      description: "Once the brand approves your verified submission, the vault releases your funds directly to your wallet.",
    }
  ]
};

export function MarketplaceCoPilot({ context, className }: { context: CoPilotContext; className?: string }) {
  const currentTips = TIPS[context];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-primary/10 rounded-full">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-bold text-sm tracking-tight uppercase text-muted-foreground">Marketplace Co-Pilot</h3>
      </div>
      
      {currentTips.map((tip, i) => (
        <Card key={i} className="border-primary/10 shadow-sm hover:border-primary/30 transition-colors bg-gradient-to-br from-background to-muted/30">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <tip.icon className="h-5 w-5 text-primary" />
              {tip.badge && (
                <Badge variant="secondary" className="text-[10px] px-1.5 h-4 font-bold bg-primary/5 text-primary border-primary/10">
                  {tip.badge}
                </Badge>
              )}
            </div>
            <CardTitle className="text-sm font-bold mt-2">{tip.title}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {tip.description}
            </p>
          </CardContent>
        </Card>
      ))}

      <div className="p-4 rounded-lg bg-primary/5 border border-primary/10 mt-6">
        <p className="text-[10px] text-primary/60 font-medium uppercase tracking-widest text-center">
          Powered by Verza AI
        </p>
      </div>
    </div>
  );
}
