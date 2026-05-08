"use client";

import { BrandGuide } from '@/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, MessageSquare, Palette, Type } from 'lucide-react';

interface BrandDeckPreviewProps {
  guide: BrandGuide;
  agencyName: string;
}

export function BrandDeckPreview({ guide, agencyName }: BrandDeckPreviewProps) {
  const {
    primaryColor = '#000000',
    secondaryColor = '#ffffff',
    logoUrl,
    typography,
    toneOfVoice,
    dos = [],
    donts = [],
    assetDriveUrl,
  } = guide;

  const slides = [
    // Slide 1: Intro
    (
      <div 
        key="intro"
        className="h-full flex flex-col items-center justify-center p-12 text-center space-y-6 animate-in fade-in zoom-in duration-500"
        style={{ 
          background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}15 100%)`,
          border: `1px solid ${primaryColor}20`
        }}
      >
        {logoUrl ? (
          <img src={logoUrl} alt={agencyName} className="h-24 w-auto object-contain drop-shadow-md" />
        ) : (
          <div className="h-24 w-24 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-4xl font-bold">
            {agencyName.charAt(0)}
          </div>
        )}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">{agencyName}</h1>
          <p className="text-muted-foreground uppercase tracking-[0.2em] text-sm font-semibold">Brand Identity Guide</p>
        </div>
        <div className="w-12 h-1 rounded-full bg-primary/20" />
      </div>
    ),
    // Slide 2: Visuals
    (
      <div key="visuals" className="h-full p-8 space-y-8 overflow-y-auto">
        <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider">
           <Palette className="h-4 w-4" />
           Visual DNA
        </div>
        
        <div className="grid grid-cols-2 gap-4">
           <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Primary Color</p>
              <div className="h-20 rounded-xl shadow-inner border flex items-end p-3" style={{ backgroundColor: primaryColor }}>
                 <span className="text-[10px] font-mono bg-white/20 backdrop-blur-md px-1.5 py-0.5 rounded text-white mix-blend-difference">{primaryColor}</span>
              </div>
           </div>
           <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Secondary Color</p>
              <div className="h-20 rounded-xl shadow-inner border flex items-end p-3" style={{ backgroundColor: secondaryColor }}>
                 <span className="text-[10px] font-mono bg-white/20 backdrop-blur-md px-1.5 py-0.5 rounded text-white mix-blend-difference">{secondaryColor}</span>
              </div>
           </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-dashed">
           <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase">
              <Type className="h-3 w-3" />
              Typography
           </div>
           <div className="p-6 rounded-xl bg-muted/30 border">
              <p className="text-2xl" style={{ fontFamily: typography || 'inherit' }}>
                The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-xs text-muted-foreground mt-2 font-mono">Font: {typography || 'Default System'}</p>
           </div>
        </div>
      </div>
    ),
    // Slide 3: Voice
    (
      <div key="voice" className="h-full p-8 space-y-8 overflow-y-auto">
         <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider">
           <MessageSquare className="h-4 w-4" />
           The Voice
        </div>

        <div className="space-y-3">
           <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Tone & Persona</p>
           <p className="text-lg leading-relaxed italic text-foreground/80">
              "{toneOfVoice || "Our voice is still being defined. We value authenticity and clarity."}"
           </p>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-6 border-t border-dashed">
           <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase tracking-wider">
                 <CheckCircle2 className="h-3 w-3" />
                 Dos
              </div>
              <div className="space-y-2">
                 {dos.filter(d => !!d).length > 0 ? dos.filter(d => !!d).map((doItem, i) => (
                    <div key={i} className="text-xs p-2 rounded-lg bg-green-50 border border-green-100 text-green-800">
                       {doItem}
                    </div>
                 )) : <p className="text-[10px] text-muted-foreground italic">No specific dos yet.</p>}
              </div>
           </div>
           <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-red-600 font-bold text-[10px] uppercase tracking-wider">
                 <XCircle className="h-3 w-3" />
                 Don'ts
              </div>
              <div className="space-y-2">
                 {donts.filter(d => !!d).length > 0 ? donts.filter(d => !!d).map((dontItem, i) => (
                    <div key={i} className="text-xs p-2 rounded-lg bg-red-50 border border-red-100 text-red-800">
                       {dontItem}
                    </div>
                 )) : <p className="text-[10px] text-muted-foreground italic">No specific donts yet.</p>}
              </div>
           </div>
        </div>
      </div>
    )
  ];

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden border border-primary/10">
      {/* Top Bar / Navigation Emulation */}
      <div className="h-12 border-b bg-muted/20 flex items-center justify-between px-6 shrink-0">
         <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/50" />
         </div>
         <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em]">
            Brand Deck Preview
         </div>
         <div className="w-10" />
      </div>

      {/* Slide Viewport */}
      <div className="flex-1 overflow-y-auto snap-y snap-mandatory scroll-smooth overflow-x-hidden">
         {slides.map((slide, i) => (
           <div key={i} className="h-full w-full snap-start shrink-0 border-b last:border-0 relative">
              <div className="absolute top-4 right-4 text-[10px] font-mono text-muted-foreground/50 z-10">
                 0{i + 1} / 0{slides.length}
              </div>
              {slide}
           </div>
         ))}
      </div>
    </div>
  );
}
