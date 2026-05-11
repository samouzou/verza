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
  ChevronRight,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { updateDoc as firestoreUpdateDoc, doc as firestoreDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import confetti from 'canvas-confetti';

type PathType = 'monetized' | 'emerging' | null;

export function CreatorCareerGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [selectedPath, setSelectedPath] = useState<PathType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  const handleComplete = async (finalPath: PathType) => {
    if (!user) return;
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

      if (finalPath === 'monetized') {
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="relative w-full max-w-4xl bg-card border shadow-2xl rounded-[2rem] overflow-hidden flex flex-col md:flex-row min-h-[600px] animate-in zoom-in-95 duration-500">
        
        {/* Left Side: Visual/Context */}
        <div className="w-full md:w-2/5 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-8 text-white flex flex-col justify-between relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl"></div>
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-400 rounded-full translate-x-1/3 translate-y-1/3 blur-3xl"></div>
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
                <h2 className="text-4xl font-bold leading-tight">Your Creator <br/>Evolution <br/>Starts Here.</h2>
                <p className="text-white/80 text-lg">We've built the tools. Now let's find the right ones for where you are today.</p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 animate-in slide-in-from-left-4 duration-500">
                <h2 className="text-4xl font-bold leading-tight">Define Your <br/>Momentum.</h2>
                <p className="text-white/80 text-lg">Are you hunting for deals, or building your empire? Be honest—there are no wrong answers.</p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 animate-in slide-in-from-left-4 duration-500">
                <h2 className="text-4xl font-bold leading-tight">The Professional <br/>Edge.</h2>
                <p className="text-white/80 text-lg">Every path leads to the same goal: Financial independence and creative freedom.</p>
              </div>
            )}
          </div>

          <div className="relative z-10 p-6 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 mt-8">
             <div className="flex gap-1 mb-2">
               {[1, 2, 3].map(i => (
                 <div key={i} className={cn("h-1 flex-1 rounded-full transition-all duration-500", i <= step ? "bg-white" : "bg-white/20")} />
               ))}
             </div>
             <p className="text-[10px] uppercase font-bold tracking-widest opacity-60">Step {step} of 3</p>
          </div>
        </div>

        {/* Right Side: Content */}
        <div className="flex-1 p-8 md:p-12 flex flex-col justify-center relative">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-6 right-6 rounded-full hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>

          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="space-y-4">
                <h3 className="text-3xl font-black tracking-tight">Ready to level up?</h3>
                <p className="text-muted-foreground text-lg">Verza is an ecosystem designed to scale with you. Before we dive in, we need to know your current focus.</p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-transparent hover:border-primary/20 transition-all group">
                  <div className="p-3 bg-indigo-500/10 rounded-xl group-hover:bg-indigo-500/20 transition-colors">
                    <Target className="h-6 w-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-bold">Personalized Roadmap</p>
                    <p className="text-xs text-muted-foreground">Find exactly where you should start based on your stats.</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-transparent hover:border-primary/20 transition-all group">
                  <div className="p-3 bg-pink-500/10 rounded-xl group-hover:bg-pink-500/20 transition-colors">
                    <Sparkles className="h-6 w-6 text-pink-600" />
                  </div>
                  <div>
                    <p className="font-bold">Creator-First Tools</p>
                    <p className="text-xs text-muted-foreground">Unlock the features that actually move the needle for you.</p>
                  </div>
                </div>
              </div>

              <Button size="lg" className="w-full h-14 rounded-2xl text-lg font-bold group" onClick={nextStep}>
                Let's Start
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h3 className="text-2xl font-black tracking-tight text-center">Where are you today?</h3>
              
              <div className="grid grid-cols-1 gap-4">
                <button 
                  className={cn(
                    "flex items-start gap-4 p-6 rounded-3xl border-2 text-left transition-all relative overflow-hidden group",
                    selectedPath === 'monetized' ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 shadow-xl scale-[1.02]" : "border-muted hover:border-indigo-400/30"
                  )}
                  onClick={() => setSelectedPath('monetized')}
                >
                  <div className={cn(
                    "p-4 rounded-2xl transition-colors",
                    selectedPath === 'monetized' ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground group-hover:bg-indigo-100"
                  )}>
                    <DollarSign className="h-8 w-8" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="font-black text-xl uppercase italic tracking-tight">The Deal Hunter</p>
                    <p className="text-sm text-muted-foreground">I'm already working with brands or have at least 10k+ followers and I'm ready to land more paid deals.</p>
                  </div>
                  {selectedPath === 'monetized' && <CheckCircle2 className="h-6 w-6 text-indigo-600 absolute top-4 right-4 animate-in zoom-in" />}
                </button>

                <button 
                  className={cn(
                    "flex items-start gap-4 p-6 rounded-3xl border-2 text-left transition-all relative overflow-hidden group",
                    selectedPath === 'emerging' ? "border-purple-600 bg-purple-50/50 dark:bg-purple-950/20 shadow-xl scale-[1.02]" : "border-muted hover:border-purple-400/30"
                  )}
                  onClick={() => setSelectedPath('emerging')}
                >
                  <div className={cn(
                    "p-4 rounded-2xl transition-colors",
                    selectedPath === 'emerging' ? "bg-purple-600 text-white" : "bg-muted text-muted-foreground group-hover:bg-purple-100"
                  )}>
                    <Rocket className="h-8 w-8" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="font-black text-xl uppercase italic tracking-tight">The Architect</p>
                    <p className="text-sm text-muted-foreground">I'm currently focused on growth. I need help scripting and creating content that converts followers.</p>
                  </div>
                  {selectedPath === 'emerging' && <CheckCircle2 className="h-6 w-6 text-purple-600 absolute top-4 right-4 animate-in zoom-in" />}
                </button>
              </div>

              <Button 
                size="lg" 
                className="w-full h-14 rounded-2xl text-lg font-bold disabled:opacity-50" 
                disabled={!selectedPath}
                onClick={nextStep}
              >
                Continue Path
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-600 text-[10px] font-black uppercase tracking-widest mb-2">
                  <ShieldCheck className="h-3 w-3" /> Professional Suite Included
                </div>
                <h3 className="text-3xl font-black tracking-tight">The Business Layer</h3>
                <p className="text-muted-foreground">No matter your path, you now have access to the Verza Business Suite.</p>
              </div>

              <div className="p-6 rounded-3xl bg-muted/50 border border-muted relative overflow-hidden">
                <Quote className="absolute top-4 left-4 h-8 w-8 text-muted-foreground/20" />
                <div className="relative z-10 space-y-4">
                  <p className="text-sm italic leading-relaxed text-foreground/80">
                    “I treat my content like a business, so I can't be waiting on Net-60 terms. Verza acted like my agent and got me paid in 14 days. It's a total game-changer for my cash flow.”
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full overflow-hidden border border-white/20 shadow-sm">
                      <img src="/jjohnson2.jpg" alt="J Johnson Jr." className="h-full w-full object-cover" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black tracking-tight">J Johnson Jr.</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">Creator · 500K+ on TikTok</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl border bg-card flex flex-col items-center text-center gap-2">
                  <LayoutDashboard className="h-5 w-5 text-indigo-600" />
                  <p className="text-[10px] font-bold uppercase">Smart Invoices</p>
                </div>
                <div className="p-4 rounded-2xl border bg-card flex flex-col items-center text-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-purple-600" />
                  <p className="text-[10px] font-bold uppercase">AI Contract Analysis</p>
                </div>
              </div>

              <Button 
                size="lg" 
                className="w-full h-16 rounded-2xl text-xl font-black uppercase italic tracking-tight" 
                onClick={() => handleComplete(selectedPath)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Setting Up...
                  </div>
                ) : (
                  selectedPath === 'monetized' ? 'Enter Marketplace' : 'Open AI Studio'
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
