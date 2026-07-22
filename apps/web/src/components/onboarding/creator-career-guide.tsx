"use client";

import { useState } from 'react';
import { 
  Zap, 
  Target, 
  Sparkles, 
  ArrowRight, 
  CheckCircle2, 
  DollarSign, 
  Rocket,
  Quote,
  LayoutDashboard,
  BrainCircuit,
  ShieldCheck,
  X,
  Users,
  Heart,
  GraduationCap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { updateDoc as firestoreUpdateDoc, doc as firestoreDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import confetti from 'canvas-confetti';

type PathType = 'monetized' | 'emerging' | 'community' | null;

const PATH_CTA: Record<Exclude<PathType, null>, string> = {
  community: 'Open Your Store',
  monetized: 'Enter Marketplace',
  emerging: 'Open AI Studio',
};

export function CreatorCareerGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [selectedPath, setSelectedPath] = useState<PathType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  const handleComplete = async (finalPath: PathType) => {
    if (!user || !finalPath) return;
    setIsSubmitting(true);
    
    try {
      await firestoreUpdateDoc(firestoreDoc(db, 'users', user.uid), {
        hasCompletedCareerPath: true,
        careerPathResult: finalPath
      });
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#a855f7', '#ec4899']
      });

      if (finalPath === 'community') {
        router.push('/store');
      } else if (finalPath === 'monetized') {
        router.push('/campaigns');
      } else {
        router.push('/ai-studio');
      }
      onClose();
    } catch (error) {
      console.error("Error saving career path:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = () => setStep(prev => prev + 1);

  const step3Copy =
    selectedPath === 'community'
      ? {
          quote:
            "My audience kept asking how to support me. I turned on tips and launched a course on Verza Store — now my community pays me directly, no brand deal required.",
          name: "Creator on Verza Store",
          subtitle: "Tips · courses · digital products",
          features: [
            { icon: Heart, label: "Tips & support" },
            { icon: GraduationCap, label: "Courses & downloads" },
          ],
        }
      : selectedPath === 'monetized'
        ? {
            quote:
              "I treat my content like a business, so I can't be waiting on Net-60 terms. Verza acted like my agent and got me paid in 14 days. It's a total game-changer for my cash flow.",
            name: "J Johnson Jr.",
            subtitle: "Creator · 500K+ on TikTok",
            image: "/jjohnson2.jpg",
            features: [
              { icon: LayoutDashboard, label: "Smart Invoices" },
              { icon: BrainCircuit, label: "AI Contract Analysis" },
            ],
          }
        : {
            quote:
              "I was stuck on what to post next. Verza's AI Studio helped me script hooks that actually converted — my growth finally felt intentional.",
            name: "Creator on Verza",
            subtitle: "Growth · content strategy",
            features: [
              { icon: Sparkles, label: "AI Scripts" },
              { icon: Rocket, label: "Content planning" },
            ],
          };

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-background/80 backdrop-blur-xl animate-in fade-in duration-500"
      role="dialog"
      aria-modal="true"
      aria-label="Creator career roadmap"
    >
      <div className="flex min-h-full justify-center px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-8">
        <div className="relative my-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border bg-card shadow-2xl animate-in zoom-in-95 duration-500 md:max-h-[min(720px,calc(100dvh-2rem))] md:min-h-[600px] md:flex-row">
        
        {/* Left Side: Visual/Context */}
        <div className="relative flex w-full shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-purple via-teal-600 to-brand-magenta p-6 text-white sm:p-8 md:w-2/5 md:p-8">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl"></div>
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-emerald-500 rounded-full translate-x-1/3 translate-y-1/3 blur-3xl"></div>
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-8">
              <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                <Zap className="h-6 w-6 fill-current" />
              </div>
              <span className="font-black text-2xl tracking-tighter uppercase italic">Verza</span>
            </div>
            
            {step === 1 && (
              <div className="space-y-4 animate-in slide-in-from-left-4 duration-500">
                <h2 className="text-3xl font-bold leading-tight sm:text-4xl">Your Creator <br/>Evolution <br/>Starts Here.</h2>
                <p className="text-base text-white/80 sm:text-lg">We&apos;ve built the tools. Now let&apos;s find the right ones for where you are today.</p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 animate-in slide-in-from-left-4 duration-500">
                <h2 className="text-3xl font-bold leading-tight sm:text-4xl">Define Your <br/>Momentum.</h2>
                <p className="text-base text-white/80 sm:text-lg">Sell to your community, land brand deals, or grow your audience — pick the path that matches your focus right now.</p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 animate-in slide-in-from-left-4 duration-500">
                <h2 className="text-3xl font-bold leading-tight sm:text-4xl">The Professional <br/>Edge.</h2>
                <p className="text-base text-white/80 sm:text-lg">Every path leads to the same goal: Financial independence and creative freedom.</p>
              </div>
            )}
          </div>

          <div className="relative z-10 mt-6 p-4 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 sm:mt-8 sm:p-6">
             <div className="flex gap-1 mb-2">
               {[1, 2, 3].map(i => (
                 <div key={i} className={cn("h-1 flex-1 rounded-full transition-all duration-500", i <= step ? "bg-white" : "bg-white/20")} />
               ))}
             </div>
             <p className="text-[10px] uppercase font-bold tracking-widest opacity-60">Step {step} of 3</p>
          </div>
        </div>

        {/* Right Side: Content */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-6 pb-8 sm:p-8 md:p-12 md:justify-center">
          <Button 
            variant="ghost" 
            size="icon" 
            className="sticky top-0 z-10 ml-auto rounded-full hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>

          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 sm:space-y-8">
              <div className="space-y-4">
                <h3 className="text-2xl font-black tracking-tight sm:text-3xl">Ready to level up?</h3>
                <p className="text-base text-muted-foreground sm:text-lg">Verza is an ecosystem designed to scale with you. Before we dive in, we need to know your current focus.</p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-transparent hover:border-primary/20 transition-all group">
                  <div className="p-3 bg-violet-500/10 rounded-xl group-hover:bg-violet-500/20 transition-colors">
                    <Users className="h-6 w-6 text-violet-600" />
                  </div>
                  <div>
                    <p className="font-bold">Community-first monetization</p>
                    <p className="text-xs text-muted-foreground">Accept tips, sell courses, and offer downloads to the people who already believe in you.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-transparent hover:border-primary/20 transition-all group">
                  <div className="p-3 bg-emerald-600/10 rounded-xl group-hover:bg-emerald-600/20 transition-colors">
                    <Target className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-bold">Personalized Roadmap</p>
                    <p className="text-xs text-muted-foreground">Find exactly where you should start based on your goals.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-transparent hover:border-primary/20 transition-all group">
                  <div className="p-3 bg-emerald-500/10 rounded-xl group-hover:bg-emerald-500/20 transition-colors">
                    <Sparkles className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-bold">Creator-First Tools</p>
                    <p className="text-xs text-muted-foreground">Unlock the features that actually move the needle for you.</p>
                  </div>
                </div>
              </div>

              <Button size="lg" className="w-full h-12 rounded-2xl text-base font-bold group sm:h-14 sm:text-lg" onClick={nextStep}>
                Let&apos;s Start
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 sm:space-y-8">
              <h3 className="text-xl font-black tracking-tight text-center sm:text-2xl">Where are you today?</h3>
              
              <div className="grid grid-cols-1 gap-3 sm:gap-4">
                <button 
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-3xl border-2 text-left transition-all relative overflow-hidden group sm:gap-4 sm:p-6",
                    selectedPath === 'community' ? "border-violet-600 bg-violet-50/50 dark:bg-violet-950/20 shadow-xl scale-[1.02]" : "border-muted hover:border-violet-500/30"
                  )}
                  onClick={() => setSelectedPath('community')}
                >
                  <div className={cn(
                    "p-3 rounded-2xl transition-colors sm:p-4",
                    selectedPath === 'community' ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground group-hover:bg-violet-100 dark:group-hover:bg-violet-950/40"
                  )}>
                    <Users className="h-6 w-6 sm:h-8 sm:w-8" />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0 pr-8">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-lg uppercase italic tracking-tight sm:text-xl">The Community Builder</p>
                      <span className="rounded-full bg-violet-600/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                        Popular
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">My audience wants to support me. I&apos;m ready to accept tips, sell courses, downloads, or exclusive access — without waiting on brands.</p>
                  </div>
                  {selectedPath === 'community' && <CheckCircle2 className="h-6 w-6 text-violet-600 absolute top-4 right-4 animate-in zoom-in" />}
                </button>

                <button 
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-3xl border-2 text-left transition-all relative overflow-hidden group sm:gap-4 sm:p-6",
                    selectedPath === 'monetized' ? "border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-xl scale-[1.02]" : "border-muted hover:border-emerald-500/30"
                  )}
                  onClick={() => setSelectedPath('monetized')}
                >
                  <div className={cn(
                    "p-3 rounded-2xl transition-colors sm:p-4",
                    selectedPath === 'monetized' ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground group-hover:bg-emerald-100"
                  )}>
                    <DollarSign className="h-6 w-6 sm:h-8 sm:w-8" />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="font-black text-lg uppercase italic tracking-tight sm:text-xl">The Deal Hunter</p>
                    <p className="text-sm text-muted-foreground">I&apos;m already working with brands or have at least 10k+ followers and I&apos;m ready to land more paid deals.</p>
                  </div>
                  {selectedPath === 'monetized' && <CheckCircle2 className="h-6 w-6 text-emerald-600 absolute top-4 right-4 animate-in zoom-in" />}
                </button>

                <button 
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-3xl border-2 text-left transition-all relative overflow-hidden group sm:gap-4 sm:p-6",
                    selectedPath === 'emerging' ? "border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-xl scale-[1.02]" : "border-muted hover:border-emerald-500/30"
                  )}
                  onClick={() => setSelectedPath('emerging')}
                >
                  <div className={cn(
                    "p-3 rounded-2xl transition-colors sm:p-4",
                    selectedPath === 'emerging' ? "bg-emerald-700 text-white" : "bg-muted text-muted-foreground group-hover:bg-emerald-100"
                  )}>
                    <Rocket className="h-6 w-6 sm:h-8 sm:w-8" />
                  </div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="font-black text-lg uppercase italic tracking-tight sm:text-xl">The Architect</p>
                    <p className="text-sm text-muted-foreground">I&apos;m focused on growth. I need help scripting and creating content that converts followers.</p>
                  </div>
                  {selectedPath === 'emerging' && <CheckCircle2 className="h-6 w-6 text-emerald-700 absolute top-4 right-4 animate-in zoom-in" />}
                </button>
              </div>

              <Button 
                size="lg" 
                className="w-full h-12 rounded-2xl text-base font-bold disabled:opacity-50 sm:h-14 sm:text-lg" 
                disabled={!selectedPath}
                onClick={nextStep}
              >
                Continue Path
              </Button>
            </div>
          )}

          {step === 3 && selectedPath && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 sm:space-y-8">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-600 text-[10px] font-black uppercase tracking-widest mb-2">
                  <ShieldCheck className="h-3 w-3" /> Professional Suite Included
                </div>
                <h3 className="text-2xl font-black tracking-tight sm:text-3xl">
                  {selectedPath === 'community' ? 'Built for Your Community' : 'The Business Layer'}
                </h3>
                <p className="text-muted-foreground">
                  {selectedPath === 'community'
                    ? 'Launch tips, your Store, and get paid by fans — run it like a real business.'
                    : 'No matter your path, you now have access to the Verza Business Suite.'}
                </p>
              </div>

              <div className="p-6 rounded-3xl bg-muted/50 border border-muted relative overflow-hidden">
                <Quote className="absolute top-4 left-4 h-8 w-8 text-muted-foreground/20" />
                <div className="relative z-10 space-y-4">
                  <p className="text-sm italic leading-relaxed text-foreground/80">
                    &ldquo;{step3Copy.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-3">
                    {'image' in step3Copy && step3Copy.image ? (
                      <div className="h-10 w-10 rounded-full overflow-hidden border border-white/20 shadow-sm">
                        <img src={step3Copy.image} alt={step3Copy.name} className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600/10 text-violet-600">
                        <Users className="h-5 w-5" />
                      </div>
                    )}
                    <div className="text-left">
                      <p className="text-sm font-black tracking-tight">{step3Copy.name}</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">{step3Copy.subtitle}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {step3Copy.features.map(({ icon: Icon, label }) => (
                  <div key={label} className="p-4 rounded-2xl border bg-card flex flex-col items-center text-center gap-2">
                    <Icon className={cn(
                      "h-5 w-5",
                      selectedPath === 'community' ? "text-violet-600" : "text-emerald-600"
                    )} />
                    <p className="text-[10px] font-bold uppercase">{label}</p>
                  </div>
                ))}
              </div>

              <Button 
                size="lg" 
                className={cn(
                  "w-full h-14 rounded-2xl text-lg font-black uppercase italic tracking-tight sm:h-16 sm:text-xl",
                  selectedPath === 'community' && "bg-violet-600 hover:bg-violet-700"
                )}
                onClick={() => handleComplete(selectedPath)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Setting Up...
                  </div>
                ) : (
                  PATH_CTA[selectedPath]
                )}
              </Button>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
