"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrandGuide, BrandProduct } from '@/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, MessageSquare, Palette, Type, ShoppingBag, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BrandDeckPreviewProps {
  guide: BrandGuide;
  agencyName: string;
  products?: BrandProduct[];
}

export function BrandDeckPreview({ guide, agencyName, products = [] }: BrandDeckPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);

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

  const slidesCount = 4;

  const nextSlide = useCallback(() => {
    if (isNavigating) return;
    setCurrentSlide((prev) => (prev < slidesCount - 1 ? prev + 1 : prev));
    setIsNavigating(true);
    setTimeout(() => setIsNavigating(false), 600);
  }, [isNavigating, slidesCount]);

  const prevSlide = useCallback(() => {
    if (isNavigating) return;
    setCurrentSlide((prev) => (prev > 0 ? prev - 1 : prev));
    setIsNavigating(true);
    setTimeout(() => setIsNavigating(false), 600);
  }, [isNavigating]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only navigate if we're not typing in an input elsewhere
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        prevSlide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

  // Mouse wheel support
  const handleWheel = (e: React.WheelEvent) => {
    if (scrollTimeout.current) return;
    
    if (Math.abs(e.deltaY) < 30) return; // Ignore small movements

    if (e.deltaY > 0) {
      nextSlide();
    } else {
      prevSlide();
    }

    scrollTimeout.current = setTimeout(() => {
      scrollTimeout.current = null;
    }, 800); // Debounce to prevent multiple jumps
  };

  const slides = [
    // Slide 1: Intro
    (
      <div 
        key="intro"
        className="h-full flex flex-col items-center justify-center p-12 text-center space-y-6"
        style={{ 
          background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}15 100%)`,
        }}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundColor: primaryColor }} />
        {logoUrl ? (
          <img src={logoUrl} alt={agencyName} className="h-24 w-auto object-contain drop-shadow-xl relative z-10" />
        ) : (
          <div className="h-24 w-24 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-4xl font-bold relative z-10">
            {agencyName.charAt(0)}
          </div>
        )}
        <div className="space-y-2 relative z-10">
          <h1 className="text-4xl font-bold tracking-tight">{agencyName}</h1>
          <p className="text-muted-foreground uppercase tracking-[0.2em] text-sm font-semibold">Brand Identity Guide</p>
        </div>
        <div className="w-12 h-1 rounded-full bg-primary/20 relative z-10" />
      </div>
    ),
    // Slide 2: Visuals
    (
      <div key="visuals" className="h-full p-8 flex flex-col">
        <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-8">
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

        <div className="space-y-4 pt-8 mt-8 border-t border-dashed">
           <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase">
              <Type className="h-3 w-3" />
              Typography
           </div>
           <div className="p-8 rounded-xl bg-muted/30 border">
              <p className="text-3xl leading-tight" style={{ fontFamily: typography || 'inherit' }}>
                The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-xs text-muted-foreground mt-4 font-mono">Font: {typography || 'Default System'}</p>
           </div>
        </div>
      </div>
    ),
    // Slide 3: Voice
    (
      <div key="voice" className="h-full p-8 flex flex-col">
         <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-8">
           <MessageSquare className="h-4 w-4" />
           The Voice
        </div>

        <div className="space-y-3 mb-8">
           <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Tone & Persona</p>
           <p className="text-xl leading-relaxed italic text-foreground/80">
              "{toneOfVoice || "Our voice is still being defined. We value authenticity and clarity."}"
           </p>
        </div>

        <div className="grid grid-cols-2 gap-6 pt-8 border-t border-dashed">
           <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-green-600 font-bold text-[10px] uppercase tracking-wider">
                 <CheckCircle2 className="h-4 w-4" />
                 Dos
              </div>
              <div className="space-y-2">
                 {dos.filter(d => !!d).length > 0 ? dos.filter(d => !!d).slice(0, 4).map((doItem, i) => (
                    <div key={i} className="text-xs p-3 rounded-lg bg-green-50/50 border border-green-100 text-green-800">
                       {doItem}
                    </div>
                 )) : <p className="text-[10px] text-muted-foreground italic">No specific dos yet.</p>}
              </div>
           </div>
           <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-red-600 font-bold text-[10px] uppercase tracking-wider">
                 <XCircle className="h-4 w-4" />
                 Don'ts
              </div>
              <div className="space-y-2">
                 {donts.filter(d => !!d).length > 0 ? donts.filter(d => !!d).slice(0, 4).map((dontItem, i) => (
                    <div key={i} className="text-xs p-3 rounded-lg bg-red-50/50 border border-red-100 text-red-800">
                       {dontItem}
                    </div>
                 )) : <p className="text-[10px] text-muted-foreground italic">No specific donts yet.</p>}
              </div>
           </div>
        </div>
      </div>
    ),
    // Slide 4: Products
    (
      <div key="products" className="h-full p-8 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-6 shrink-0">
           <ShoppingBag className="h-4 w-4" />
           The Lookbook
        </div>

        {products.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 overflow-y-auto pr-2 scrollbar-thin">
             {products.map((product) => (
               <div key={product.id} className="group relative rounded-xl border bg-muted/20 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
                  <div className="aspect-square w-full overflow-hidden bg-white">
                     {product.imageUrl ? (
                       <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                     ) : (
                       <div className="w-full h-full flex items-center justify-center">
                          <ShoppingBag className="h-8 w-8 text-muted-foreground/20" />
                       </div>
                     )}
                  </div>
                  <div className="p-3 space-y-1 flex-1 flex flex-col justify-between">
                     <div>
                        <h4 className="text-[11px] font-bold truncate uppercase tracking-tight">{product.name}</h4>
                        <p className="text-[10px] text-muted-foreground line-clamp-1">{product.description}</p>
                     </div>
                     <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] font-bold text-primary">${product.price.toFixed(2)}</span>
                        <div className="flex gap-1">
                           {product.usps?.slice(0, 1).map((usp, i) => (
                             <div key={i} className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-[4px] text-[8px] font-bold">
                                {usp}
                             </div>
                           ))}
                        </div>
                     </div>
                  </div>
               </div>
             ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
             <div className="p-6 rounded-full bg-muted/50 text-muted-foreground/30">
                <ShoppingBag className="h-12 w-12" />
             </div>
             <div className="space-y-1">
                <p className="text-sm font-bold">Catalog Empty</p>
                <p className="text-xs text-muted-foreground">Add products in the catalog page to showcase them here.</p>
             </div>
          </div>
        )}
      </div>
    )
  ];

  return (
    <div 
      className="w-full h-full flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden border border-primary/10 select-none group"
      onWheel={handleWheel}
    >
      {/* Top Bar */}
      <div className="h-12 border-b bg-muted/20 flex items-center justify-between px-6 shrink-0 z-20">
         <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/50" />
         </div>
         <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em]">
            {agencyName} identity
         </div>
         <div className="text-[10px] font-mono text-muted-foreground/40">
            Slide {currentSlide + 1} / {slidesCount}
         </div>
      </div>

      {/* Slide Container */}
      <div className="flex-1 relative overflow-hidden bg-background">
         {slides.map((slide, i) => (
            <div 
               key={i} 
               className={cn(
                  "absolute inset-0 transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1)",
                  i === currentSlide 
                    ? "translate-y-0 opacity-100 z-10" 
                    : i < currentSlide 
                      ? "-translate-y-full opacity-0 z-0" 
                      : "translate-y-full opacity-0 z-0"
               )}
            >
               {slide}
            </div>
         ))}

         {/* Navigation Arrows (On Hover) */}
         <div className="absolute inset-y-0 right-4 flex flex-col items-center justify-center gap-4 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <Button 
              variant="secondary" 
              size="icon" 
              className="h-10 w-10 rounded-full shadow-lg border border-primary/10 bg-white/80 backdrop-blur-md"
              onClick={prevSlide}
              disabled={currentSlide === 0}
            >
              <ChevronUp className="h-5 w-5 text-primary" />
            </Button>
            
            <div className="flex flex-col gap-2 p-2 rounded-full bg-white/50 backdrop-blur-sm border border-primary/5">
              {Array.from({ length: slidesCount }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  className={cn(
                    "w-2 h-2 rounded-full transition-all duration-300",
                    i === currentSlide ? "bg-primary h-6" : "bg-primary/20 hover:bg-primary/40"
                  )}
                />
              ))}
            </div>

            <Button 
              variant="secondary" 
              size="icon" 
              className="h-10 w-10 rounded-full shadow-lg border border-primary/10 bg-white/80 backdrop-blur-md"
              onClick={nextSlide}
              disabled={currentSlide === slidesCount - 1}
            >
              <ChevronDown className="h-5 w-5 text-primary" />
            </Button>
         </div>
      </div>

      {/* Bottom Footer Info */}
      <div className="h-10 border-t bg-muted/5 flex items-center justify-between px-6 shrink-0 z-20">
         <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Live Deck</span>
         </div>
         <div className="text-[9px] text-muted-foreground italic">
            Use arrows, space, or scroll to navigate
         </div>
      </div>
    </div>
  );
}
