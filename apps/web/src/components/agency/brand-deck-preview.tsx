"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrandGuide, BrandProduct } from '@/types';
import { cn } from '@/lib/utils';
import { 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  Palette, 
  Type, 
  ShoppingBag, 
  ChevronUp, 
  ChevronDown, 
  Download, 
  Zap, 
  Video,
  PlayCircle,
  X,
  ExternalLink,
  Maximize2,
  Target
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface BrandDeckPreviewProps {
  guide: BrandGuide;
  agencyName: string;
  products?: BrandProduct[];
  onClose?: () => void;
}

export function BrandDeckPreview({ guide, agencyName, products = [], onClose }: BrandDeckPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<BrandProduct | null>(null);
  const lastScrollTime = useRef<number>(0);

  const {
    primaryColor = '#000000',
    secondaryColor = '#ffffff',
    logoUrl,
    typography,
    toneOfVoice,
    dos = [],
    donts = [],
    bRollLibrary = [],
  } = guide;

  // Helper to chunk products (4 per slide for a premium look)
  const chunkArray = (arr: any[], size: number) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  };

  const productChunks = chunkArray(products, 4);
  const totalProductSlides = productChunks.length || 1;
  
  // Total Slides: Intro(1) + Visuals(1) + Voice(1) + Products(N) + B-Roll(1 if exists)
  const baseSlidesCount = 3; // Intro, Visuals, Voice
  const slidesCount = baseSlidesCount + totalProductSlides + (bRollLibrary.length > 0 ? 1 : 0);

  const nextSlide = useCallback(() => {
    if (isNavigating || selectedProduct) return;
    if (currentSlide >= slidesCount - 1) return;
    setIsNavigating(true);
    setCurrentSlide(currentSlide + 1);
    setTimeout(() => setIsNavigating(false), 600);
  }, [isNavigating, currentSlide, slidesCount, selectedProduct]);

  const prevSlide = useCallback(() => {
    if (isNavigating || selectedProduct) return;
    if (currentSlide <= 0) return;
    setIsNavigating(true);
    setCurrentSlide(currentSlide - 1);
    setTimeout(() => setIsNavigating(false), 600);
  }, [isNavigating, currentSlide, selectedProduct]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (selectedProduct) {
        if (e.key === 'Escape') setSelectedProduct(null);
        return;
      }

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
  }, [nextSlide, prevSlide, selectedProduct]);

  // Mouse wheel support
  const handleWheel = (e: React.WheelEvent) => {
    if (selectedProduct) return;
    const now = Date.now();
    if (now - lastScrollTime.current < 1000) return;
    if (Math.abs(e.deltaY) < 30) return; 

    if (e.deltaY > 0) {
      nextSlide();
    } else {
      prevSlide();
    }

    lastScrollTime.current = now;
  };

  const handleDownload = (url: string, filename: string) => {
    window.open(url, '_blank');
  };

  const renderSlides = () => {
    const allSlides = [];

    // Slide 1: Intro
    allSlides.push(
      <div key="intro" className="h-full w-full flex flex-col items-center justify-center p-12 text-center space-y-6 relative overflow-hidden bg-white dark:bg-[#0f1115]">
        <div className="absolute inset-0 opacity-[0.08] dark:opacity-[0.12]" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }} />
        <div className="relative z-20 flex flex-col items-center space-y-6 w-full">
          {logoUrl ? <img src={logoUrl} alt={agencyName} className="h-24 w-auto object-contain drop-shadow-xl" /> : (
            <div className="h-24 w-24 rounded-2xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary text-4xl font-bold shadow-sm">{agencyName.charAt(0)}</div>
          )}
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-foreground dark:text-white">{agencyName}</h1>
            <p className="text-muted-foreground dark:text-muted-foreground/60 uppercase tracking-[0.2em] text-sm font-semibold">Brand Identity Guide</p>
          </div>
          <div className="w-12 h-1 rounded-full bg-primary/20 dark:bg-primary/40" />
        </div>
      </div>
    );

    // Slide 1.5: The Mission
    if (guide.missionStatement) {
      allSlides.push(
        <div key="mission" className="h-full w-full flex flex-col items-center justify-center p-16 text-center space-y-8 bg-white dark:bg-[#0f1115] relative overflow-hidden">
           <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 dark:bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
           <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary/5 dark:bg-secondary/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl" />
           
           <div className="relative z-10 space-y-4">
              <div className="flex items-center justify-center gap-2 text-primary font-bold text-xs uppercase tracking-[0.4em] mb-4">
                 <Target className="h-4 w-4" /> The Mission
              </div>
              <h2 className="text-3xl md:text-4xl font-bold leading-tight text-foreground dark:text-white max-w-2xl italic font-serif">
                 "{guide.missionStatement}"
              </h2>
              <div className="w-16 h-1.5 rounded-full bg-primary/20 dark:bg-primary/40 mx-auto mt-8" />
           </div>
        </div>
      );
    }

    // Slide 2: Visuals
    allSlides.push(
      <div key="visuals" className="h-full w-full p-8 flex flex-col bg-white dark:bg-[#0f1115] relative">
        <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-8"><Palette className="h-4 w-4" /> Visual DNA</div>
        <div className="grid grid-cols-2 gap-4">
           <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/60">Primary</p>
              <div className="h-14 rounded-xl shadow-inner border dark:border-white/10 flex items-end p-2" style={{ backgroundColor: primaryColor }}>
                 <span className="text-[9px] font-mono bg-white/60 dark:bg-black/60 px-1 py-0.5 rounded text-black dark:text-white font-bold border border-black/10 dark:border-white/10">{primaryColor}</span>
              </div>
           </div>
           <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/60">Secondary</p>
              <div className="h-14 rounded-xl shadow-inner border dark:border-white/10 flex items-end p-2" style={{ backgroundColor: secondaryColor }}>
                 <span className="text-[9px] font-mono bg-white/60 dark:bg-black/60 px-1 py-0.5 rounded text-black dark:text-white font-bold border border-black/10 dark:border-white/10">{secondaryColor}</span>
              </div>
           </div>
           <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/60">Accent</p>
              <div className="h-14 rounded-xl shadow-inner border dark:border-white/10 flex items-end p-2" style={{ backgroundColor: guide.accentColor || '#6366f1' }}>
                 <span className="text-[9px] font-mono bg-white/60 dark:bg-black/60 px-1 py-0.5 rounded text-black dark:text-white font-bold border border-black/10 dark:border-white/10">{guide.accentColor || '#6366f1'}</span>
              </div>
           </div>
           <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/60">Neutral</p>
              <div className="h-14 rounded-xl shadow-inner border dark:border-white/10 flex items-end p-2" style={{ backgroundColor: guide.neutralColor || '#f4f4f5' }}>
                 <span className="text-[9px] font-mono bg-white/60 dark:bg-black/60 px-1 py-0.5 rounded text-black dark:text-white font-bold border border-black/10 dark:border-white/10">{guide.neutralColor || '#f4f4f5'}</span>
              </div>
           </div>
        </div>
        <div className="space-y-4 pt-6 mt-6 border-t border-dashed dark:border-white/10 flex-1 flex flex-col">
           <div className="flex items-center gap-2 text-muted-foreground dark:text-muted-foreground/60 font-medium text-xs uppercase"><Type className="h-3 w-3" /> Typography</div>
           <div className="p-8 rounded-xl bg-muted/30 dark:bg-white/5 border dark:border-white/5 shadow-sm flex-1 flex flex-col justify-center">
              <p className="text-3xl leading-tight text-foreground dark:text-white/90" style={{ fontFamily: typography || 'inherit' }}>The quick brown fox jumps over the lazy dog.</p>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground/40 mt-4 font-mono">Font: {typography || 'Default System'}</p>
           </div>
        </div>
      </div>
    );

    // Slide 3: Voice
    allSlides.push(
      <div key="voice" className="h-full w-full p-8 flex flex-col bg-white dark:bg-[#0f1115] relative">
         <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-8"><MessageSquare className="h-4 w-4" /> The Voice</div>
        <div className="space-y-3 mb-8">
           <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/60 uppercase tracking-widest">Tone & Persona</p>
           <p className="text-xl leading-relaxed italic text-foreground/80 dark:text-white/70">"{toneOfVoice || "Our voice is still being defined. We value authenticity and clarity."}"</p>
        </div>
        <div className="grid grid-cols-2 gap-6 pt-8 border-t border-dashed dark:border-white/10 flex-1">
           <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-bold text-[10px] uppercase tracking-wider"><CheckCircle2 className="h-4 w-4" /> Dos</div>
              <div className="space-y-2">
                 {dos.filter(d => !!d).length > 0 ? dos.filter(d => !!d).slice(0, 4).map((doItem, i) => (
                    <div key={i} className="text-xs p-3 rounded-lg bg-green-50/50 dark:bg-green-400/5 border border-green-100 dark:border-green-400/10 text-green-800 dark:text-green-400 shadow-sm">{doItem}</div>
                 )) : <p className="text-[10px] text-muted-foreground dark:text-muted-foreground/40 italic">No specific dos yet.</p>}
              </div>
           </div>
           <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-bold text-[10px] uppercase tracking-wider"><XCircle className="h-4 w-4" /> Don'ts</div>
              <div className="space-y-2">
                 {donts.filter(d => !!d).length > 0 ? donts.filter(d => !!d).slice(0, 4).map((dontItem, i) => (
                    <div key={i} className="text-xs p-3 rounded-lg bg-red-50/50 dark:bg-red-400/5 border border-red-100 dark:border-red-400/10 text-red-800 dark:text-red-400 shadow-sm">{dontItem}</div>
                 )) : <p className="text-[10px] text-muted-foreground dark:text-muted-foreground/40 italic">No specific donts yet.</p>}
              </div>
           </div>
        </div>
      </div>
    );

    // Slide 4+: Products (Chunked)
    if (productChunks.length === 0) {
      allSlides.push(
        <div key="products-empty" className="h-full w-full p-8 flex flex-col bg-white dark:bg-[#0f1115] relative">
           <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-6 shrink-0"><ShoppingBag className="h-4 w-4" /> The Lookbook</div>
           <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
             <div className="p-6 rounded-full bg-muted/50 dark:bg-white/5 text-muted-foreground/30"><ShoppingBag className="h-12 w-12" /></div>
             <p className="text-sm font-bold text-foreground dark:text-white/60">Catalog Empty</p>
          </div>
        </div>
      );
    } else {
      productChunks.forEach((chunk, chunkIndex) => {
        allSlides.push(
          <div key={`products-${chunkIndex}`} className="h-full w-full p-8 flex flex-col bg-white dark:bg-[#0f1115] relative">
            <div className="flex items-center justify-between mb-6 shrink-0">
               <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider">
                  <ShoppingBag className="h-4 w-4" />
                  Lookbook {productChunks.length > 1 ? `(${chunkIndex + 1}/${productChunks.length})` : ''}
               </div>
               <span className="text-[10px] text-muted-foreground dark:text-muted-foreground/40 font-medium uppercase tracking-widest">Select product for spotlight</span>
            </div>
            <div className="grid grid-cols-2 grid-rows-2 gap-3 flex-1 min-h-0">
               {chunk.map((product: BrandProduct) => (
                 <div 
                   key={product.id} 
                   className="group relative rounded-xl border dark:border-white/10 bg-muted/20 dark:bg-white/5 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer min-h-0"
                   onClick={() => setSelectedProduct(product)}
                 >
                    <div className="flex-1 min-h-0 w-full bg-white dark:bg-black/20 relative overflow-hidden">
                       {product.imageUrl ? (
                         <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain transition-transform group-hover:scale-105" />
                       ) : (
                         <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="h-6 w-6 text-muted-foreground/20 dark:text-white/10" /></div>
                       )}
                       <div className="absolute inset-0 bg-black/5 dark:bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="bg-white/90 dark:bg-black/80 backdrop-blur-sm px-2.5 py-1 rounded-full shadow-lg border border-primary/10 dark:border-white/10 scale-90 group-hover:scale-100 transition-transform">
                             <span className="text-[9px] font-bold text-primary dark:text-white flex items-center gap-1">
                               {product.videoUrl ? <PlayCircle className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                               Spotlight
                             </span>
                          </div>
                       </div>
                    </div>
                    <div className="p-2 space-y-0.5 shrink-0 bg-white/50 dark:bg-white/5 backdrop-blur-sm border-t dark:border-white/5">
                       <h4 className="text-[10px] font-bold truncate uppercase tracking-tight text-foreground dark:text-white/80">{product.name}</h4>
                       <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-primary">${product.price.toFixed(2)}</span>
                          {product.videoUrl && <Video className="h-2.5 w-2.5 text-primary animate-pulse" />}
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          </div>
        );
      });
    }

    // Slide Last: B-Roll
    if (bRollLibrary.length > 0) {
      allSlides.push(
        <div key="b-roll" className="h-full w-full p-8 flex flex-col bg-white dark:bg-[#0f1115] relative">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider mb-6 shrink-0"><Video className="h-4 w-4" /> Production Kit (B-Roll)</div>
          <div className="grid grid-cols-2 gap-4 overflow-y-auto pr-2 scrollbar-thin">
             {bRollLibrary.map((asset) => (
               <div key={asset.id} className="group relative rounded-xl border dark:border-white/10 bg-black overflow-hidden aspect-video flex items-center justify-center shadow-md">
                  <video src={asset.url} className="h-full w-full object-cover opacity-60 dark:opacity-40" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity"><PlayCircle className="h-10 w-10 text-white opacity-80" /></div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                     <Button variant="secondary" size="sm" className="bg-white/90 dark:bg-white hover:bg-white text-primary font-bold text-[10px]" onClick={(e) => { e.stopPropagation(); handleDownload(asset.url, `broll_${asset.id}.mp4`); }}>
                       <Download className="h-3 w-3 mr-1.5" /> Download Clip
                     </Button>
                  </div>
                  <div className="absolute bottom-2 left-2 right-2"><p className="text-[9px] text-white/70 dark:text-white/50 font-mono truncate">{asset.name}</p></div>
               </div>
             ))}
          </div>
        </div>
      );
    }

    return allSlides;
  };

  const slides = renderSlides();

  return (
    <div className="w-full h-full min-h-[400px] flex flex-col bg-white dark:bg-[#0f1115] rounded-2xl shadow-2xl overflow-hidden border border-primary/10 dark:border-white/5 select-none relative" onWheel={handleWheel}>
      {/* Top Bar */}
      <div className="h-12 border-b dark:border-white/5 bg-muted/20 dark:bg-black/40 flex items-center justify-between px-6 shrink-0 z-30">
         <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
         </div>
         <div className="text-[10px] font-bold text-muted-foreground dark:text-muted-foreground/60 uppercase tracking-[0.3em]">{agencyName} identity</div>
         <div className="flex items-center gap-4">
            <div className="text-[10px] font-mono text-muted-foreground/40 dark:text-white/20">Slide {currentSlide + 1} / {slidesCount}</div>
            {onClose && (
               <button 
                 onClick={onClose}
                 className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors text-muted-foreground hover:text-foreground dark:text-white/40 dark:hover:text-white"
                 title="Close Preview"
               >
                  <X className="h-4 w-4" />
               </button>
            )}
         </div>
      </div>

      {/* Slide Container */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-white isolate">
         {slides.map((slide, i) => (
            <div key={i} className={cn("absolute inset-0 w-full h-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]", i === currentSlide ? "translate-y-0 opacity-100 z-10 pointer-events-auto" : i < currentSlide ? "-translate-y-full opacity-0 z-0 pointer-events-none" : "translate-y-full opacity-0 z-0 pointer-events-none")}>
               {slide}
            </div>
         ))}

         {/* Navigation Arrows */}
         {!selectedProduct && (
           <div className="absolute inset-y-0 right-4 flex flex-col items-center justify-center gap-4 z-40">
              <Button variant="secondary" size="icon" className="h-10 w-10 rounded-full shadow-lg border border-primary/10 bg-white hover:bg-muted transition-transform hover:scale-110 active:scale-95" onClick={prevSlide} disabled={currentSlide === 0}><ChevronUp className="h-5 w-5 text-primary" /></Button>
              <div className="flex flex-col gap-2 p-2 rounded-full bg-white/80 border border-primary/5 shadow-sm">
                {Array.from({ length: slidesCount }).map((_, i) => (
                  <button key={i} onClick={() => setCurrentSlide(i)} className={cn("w-2 h-2 rounded-full transition-all duration-300", i === currentSlide ? "bg-primary h-6" : "bg-primary/20 hover:bg-primary/40")} />
                ))}
              </div>
              <Button variant="secondary" size="icon" className="h-10 w-10 rounded-full shadow-lg border border-primary/10 bg-white hover:bg-muted transition-transform hover:scale-110 active:scale-95" onClick={nextSlide} disabled={currentSlide === slidesCount - 1}><ChevronDown className="h-5 w-5 text-primary" /></Button>
           </div>
         )}

         {/* Product Spotlight Overlay */}
         {selectedProduct && (
           <div className="absolute inset-0 z-50 bg-white dark:bg-[#0a0a0b] animate-in fade-in slide-in-from-bottom-4 duration-300 flex flex-col">
              <div className="flex items-center justify-between p-6 border-b dark:border-white/5 shrink-0">
                 <div className="flex items-center gap-3">
                    <div className="bg-primary/10 dark:bg-primary/20 p-2 rounded-lg"><ShoppingBag className="h-5 w-5 text-primary" /></div>
                    <h3 className="text-xl font-bold tracking-tight uppercase dark:text-white">{selectedProduct.name}</h3>
                 </div>
                 <Button variant="ghost" size="icon" onClick={() => setSelectedProduct(null)} className="rounded-full h-10 w-10 dark:hover:bg-white/5 dark:text-white/60"><X className="h-6 w-6" /></Button>
              </div>

              <div className="flex-1 min-h-0 flex overflow-hidden">
                 {/* Asset View */}
                 <div className="flex-1 bg-black relative group flex items-center justify-center">
                    {selectedProduct.videoUrl ? (
                      <video 
                        src={selectedProduct.videoUrl} 
                        className="w-full h-full object-contain" 
                        autoPlay 
                        loop 
                        controls
                      />
                    ) : (
                      <img src={selectedProduct.imageUrl} className="w-full h-full object-contain" alt={selectedProduct.name} />
                    )}
                    
                    {!selectedProduct.videoUrl && (
                      <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                         <Button variant="secondary" onClick={() => handleDownload(selectedProduct.imageUrl, `${selectedProduct.name}.jpg`)}>
                            <Download className="h-4 w-4 mr-2" /> Download Image
                         </Button>
                      </div>
                    )}
                 </div>

                 {/* Product Info View */}
                 <div className="w-[320px] shrink-0 p-8 border-l dark:border-white/5 flex flex-col justify-between bg-white dark:bg-[#0f1115] overflow-y-auto">
                    <div className="space-y-8">
                       <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground dark:text-muted-foreground/60">About the product</p>
                          <p className="text-sm leading-relaxed text-foreground/80 dark:text-white/70">{selectedProduct.description}</p>
                       </div>

                       <div className="space-y-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground dark:text-muted-foreground/60">Unique Selling Points</p>
                          <div className="flex flex-wrap gap-2">
                             {selectedProduct.usps?.map((usp, i) => (
                               <div key={i} className="bg-primary/5 dark:bg-primary/10 text-primary border border-primary/10 dark:border-primary/20 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {usp}
                               </div>
                             ))}
                          </div>
                       </div>
                    </div>

                    <div className="space-y-4 pt-8">
                       <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold text-primary">${selectedProduct.price.toFixed(2)}</span>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-3">
                          <Button variant="outline" className="w-full dark:border-white/10 dark:hover:bg-white/5" asChild>
                             <a href={selectedProduct.url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 mr-2" /> Store
                             </a>
                          </Button>
                          <Button variant="primary" className="w-full" asChild>
                             <Link href={`/ai-studio?ref=${encodeURIComponent(selectedProduct.imageUrl)}&product=${encodeURIComponent(selectedProduct.name)}`}>
                                <Zap className="h-4 w-4 mr-2" /> Generate
                             </Link>
                          </Button>
                       </div>
                    </div>
                 </div>
              </div>
           </div>
         )}
      </div>

      {/* Bottom Footer Info */}
      <div className="h-10 border-t dark:border-white/5 bg-muted/5 dark:bg-black/20 flex items-center justify-between px-6 shrink-0 z-30">
         <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[9px] font-bold text-muted-foreground dark:text-muted-foreground/60 uppercase tracking-widest">Live Deck</span>
         </div>
         <div className="text-[9px] text-muted-foreground dark:text-white/40 italic px-8 truncate">
            {selectedProduct ? "Watching Product Spotlight" : currentSlide >= baseSlidesCount && currentSlide < baseSlidesCount + totalProductSlides ? "Click a product for spotlight & video" : "Use arrows, space, or scroll to navigate"}
         </div>
      </div>
    </div>
  );
}
