"use client";

import { useState, useEffect, ChangeEvent, Suspense } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Video, Download, History, Monitor, Smartphone, Users, PlusCircle, Image as ImageIcon, Camera, Trash2, LifeBuoy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { onSnapshot, collection, query, where, orderBy, doc, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import type { Generation, Character } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { useTour } from '@/hooks/use-tour';
import { aiStudioTour } from '@/lib/tours';
import { trackEvent } from '@/lib/analytics';
import { useRouter, useSearchParams } from 'next/navigation';
import confetti from 'canvas-confetti';

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;
const VIDEO_COST = 10;
const IMAGE_COST = 1;

const INSPIRATION_EXAMPLES = [
  {
    tab: "text-to-video",
    style: "Realistic",
    prompt: "Golden hour lifestyle shot of someone hiking through a misty forest, cinematic",
    gradient: "from-emerald-900 via-teal-800 to-cyan-700",
    label: "Lifestyle Video",
  },
  {
    tab: "text-to-image",
    style: "Realistic",
    prompt: "Brand ambassador posing confidently in front of a luxury hotel lobby, editorial lighting",
    gradient: "from-slate-900 via-purple-900 to-indigo-800",
    label: "Brand Shoot",
  },
  {
    tab: "text-to-video",
    style: "Anime",
    prompt: "Anime-style cityscape with cherry blossoms falling at dusk, glowing streetlights",
    gradient: "from-pink-900 via-rose-700 to-orange-600",
    label: "Anime Scene",
  },
  {
    tab: "text-to-image",
    style: "3D Render",
    prompt: "Sleek skincare product on a marble surface with soft diffused lighting, minimalist",
    gradient: "from-zinc-800 via-stone-700 to-amber-700",
    label: "Product Shot",
  },
  {
    tab: "text-to-video",
    style: "Claymation",
    prompt: "Claymation character dancing in a candy-colored kitchen, playful and bouncy",
    gradient: "from-violet-800 via-fuchsia-700 to-pink-600",
    label: "Claymation",
  },
  {
    tab: "text-to-image",
    style: "Anime",
    prompt: "Anime creator recording content in a neon-lit bedroom studio, vibrant colors",
    gradient: "from-blue-900 via-indigo-700 to-violet-600",
    label: "Creator Studio",
  },
] as const;

function SceneSpawnerContent() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const { toast } = useToast();
  const { startTour } = useTour();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState("text-to-video");
  const [marqueePaused, setMarqueePaused] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof styleOptions)[number]>("Realistic");
  const [orientation, setOrientation] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  
  const [generatedMedia, setGeneratedMedia] = useState<{ url: string; type: 'video' | 'image' } | null>(null);

  const [history, setHistory] = useState<Generation[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  // New state for Characters
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isCharacterDialogOpen, setIsCharacterDialogOpen] = useState(false);
  const [newCharacterName, setNewCharacterName] = useState("");
  const [newCharacterDescription, setNewCharacterDescription] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('none');
  const [isSavingCharacter, setIsSavingCharacter] = useState(false);
  const [isDeletingCharacter, setIsDeletingCharacter] = useState(false);
  const [characterToDelete, setCharacterToDelete] = useState<Character | null>(null);
  
  // State for Image-to-Video and Image-to-Image
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");

  useEffect(() => {
    if (searchParams.get('purchase_success') === 'true') {
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      
      trackEvent({
        action: 'credit_purchase_success',
        category: 'revenue',
        label: 'scene_credits'
      });

      router.replace('/ai-studio', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (!user?.uid) return;

    setIsLoadingHistory(true);
    const q = query(
      collection(db, 'generations'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribeHistory = onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Generation)));
      setIsLoadingHistory(false);
    }, (error) => {
      console.error("Error fetching generation history:", error);
      toast({ title: "History Error", description: "Could not load generation history.", variant: "destructive" });
      setIsLoadingHistory(false);
    });

    const charactersQuery = query(
      collection(db, 'users', user.uid, 'characters'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribeCharacters = onSnapshot(charactersQuery, (snapshot) => {
      setCharacters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Character)));
    }, (error) => {
      console.error("Error fetching characters:", error);
      toast({ title: "Error", description: "Could not load your characters.", variant: "destructive" });
    });

    return () => {
        unsubscribeHistory();
        unsubscribeCharacters();
    };
  }, [user, toast]);
  
  const handleImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit for images
        toast({ title: "File Too Large", description: "Please select an image smaller than 4MB.", variant: "destructive" });
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePurchaseCredits = async (planKey: 'starter' | 'agency') => {
    setIsProcessingPayment(true);
    trackEvent({
      action: 'credit_checkout_start',
      category: 'revenue',
      label: planKey
    });

    try {
      const createCheckoutSession = httpsCallable(functions, 'createCreditCheckoutSession');
      const result = await createCheckoutSession({ planKey });
      const data = result.data as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Could not retrieve checkout URL.");
      }
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      toast({ title: "Payment Error", description: error.message || "Could not start payment process.", variant: "destructive" });
      setIsProcessingPayment(false);
    }
  };

  const handleGeneration = async () => {
    if (!user) {
      toast({ title: "Authentication Error", variant: "destructive" });
      return;
    }

    const mode = activeTab;
    const isTextMode = mode === 'text-to-video' || mode === 'text-to-image';
    const isImageMode = mode === 'image-to-video' || mode === 'image-to-image';
    const currentPrompt = isTextMode ? prompt : imagePrompt;
    const cost = (mode === 'image-to-image' || mode === 'text-to-image') ? IMAGE_COST : VIDEO_COST;
    const credits = user.credits ?? 0;

    if (!currentPrompt.trim() || (isImageMode && !imageFile)) {
      toast({ title: "Missing Input", description: `Please provide a prompt${isImageMode ? ' and an image' : ''}.`, variant: "destructive" });
      return;
    }
     if (credits < cost) {
      toast({ title: "No Credits", description: `This action costs ${cost} credits. You have ${credits}.`, variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    setGeneratedMedia(null);
    toast({ title: "Spawning...", description: "AI is generating your media. This may take a minute or two." });

    try {
      let result;
      let data: any;
      let imageDataUri: string | undefined;

      if (mode !== 'text-to-video' && imageFile) {
        imageDataUri = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(imageFile);
        });
      }
      
      trackEvent({ action: 'spawn_scene_start', category: 'ai_tool', label: mode });

      if (mode === 'image-to-image' || mode === 'text-to-image') {
        const generateImageCallable = httpsCallable(functions, 'generateImage');
        result = await generateImageCallable({ prompt: currentPrompt, style, orientation, imageDataUri });
        data = result.data as { imageUrl: string, remainingCredits: number };
        setGeneratedMedia({ url: data.imageUrl, type: 'image' });
      } else {
        const generateSceneCallable = httpsCallable(functions, 'generateScene');
        result = await generateSceneCallable({ prompt: currentPrompt, style, orientation, imageDataUri });
        data = result.data as { videoUrl: string, remainingCredits: number };
        setGeneratedMedia({ url: data.videoUrl, type: 'video' });
      }

      trackEvent({ action: 'spawn_scene_success', category: 'ai_tool', label: mode });

      toast({ title: "Generation Complete!", description: `Your media is ready. You have ${data.remainingCredits} credits left.` });
      await refreshAuthUser();
    } catch (error: any) {
      console.error("Error generating media:", error);
      toast({ title: "Generation Failed", description: error.message || "An unknown error occurred.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveCharacter = async () => {
    if (!user) return;
    if (!newCharacterName.trim() || !newCharacterDescription.trim()) {
        toast({title: "Missing Information", description: "Please provide a name and description.", variant: "destructive"});
        return;
    }
    setIsSavingCharacter(true);
    try {
        const characterData = {
            userId: user.uid,
            name: newCharacterName.trim(),
            description: newCharacterDescription.trim(),
            createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, 'users', user.uid, 'characters'), characterData);
        trackEvent({ action: 'create_character', category: 'engagement', label: 'ai_studio' });
        toast({title: "Character Saved!", description: `${newCharacterName.trim()} is now available.`});
        setNewCharacterName("");
        setNewCharacterDescription("");
        setIsCharacterDialogOpen(false);
    } catch (error) {
        console.error("Error saving character:", error);
        toast({title: "Save Failed", description: "Could not save character.", variant: "destructive"});
    } finally {
        setIsSavingCharacter(false);
    }
  };
  
  const handleDeleteCharacter = async () => {
    if (!user || !characterToDelete) return;
    setIsDeletingCharacter(true);
    try {
        await deleteDoc(doc(db, 'users', user.uid, 'characters', characterToDelete.id));
        toast({title: "Character Deleted"});
        setCharacterToDelete(null); // This will close the dialog
    } catch (error) {
        console.error("Error deleting character:", error);
        toast({title: "Delete Failed", variant: "destructive"});
    } finally {
        setIsDeletingCharacter(false);
    }
 };


  const cost = (activeTab === 'image-to-image' || activeTab === 'text-to-image') ? IMAGE_COST : VIDEO_COST;
  const credits = user?.credits ?? 0;
  const canAfford = credits >= cost;

  const isGenerateButtonDisabled = isGenerating ||
    ((activeTab === 'text-to-video' || activeTab === 'text-to-image') && !prompt.trim()) ||
    ((activeTab === 'image-to-video' || activeTab === 'image-to-image') && (!imagePrompt.trim() || !imageFile));


  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  return (
    <>
      <style>{`
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

      {/* Cinematic hero */}
      <div
        className="relative rounded-2xl overflow-hidden mb-6"
        style={{
          background: 'linear-gradient(135deg, #0f0c29, #302b63, #1a1a4e, #24105a)',
          backgroundSize: '400% 400%',
          animation: 'gradient-shift 12s ease infinite',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg,transparent,transparent 40px,rgba(255,255,255,0.8) 40px,rgba(255,255,255,0.8) 41px),repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(255,255,255,0.8) 40px,rgba(255,255,255,0.8) 41px)',
          }}
        />
        <div className="absolute top-0 right-1/4 w-72 h-72 bg-violet-600/25 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-56 h-56 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-7 sm:px-8 sm:py-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <Sparkles className="h-6 w-6 text-violet-300" />
              <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">AI Studio</h1>
            </div>
            <p className="text-sm text-white/55 max-w-sm leading-relaxed">
              Turn a prompt into a video or image in seconds. Click an example below or write your own.
            </p>
          </div>
          <div className="flex items-center gap-5 flex-shrink-0">
            <div className="text-right">
              <p className={`text-4xl font-bold tabular-nums leading-none ${credits > 20 ? 'text-emerald-400' : credits > 5 ? 'text-amber-400' : 'text-red-400'}`}>
                {credits}
              </p>
              <p className="text-[11px] text-white/40 uppercase tracking-widest mt-1">credits</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-white bg-white/5 hover:bg-white/15 hover:text-white"
              onClick={() => startTour(aiStudioTour)}
            >
              <LifeBuoy className="mr-2 h-4 w-4" /> Tour
            </Button>
          </div>
        </div>
      </div>

      {/* Auto-scrolling inspiration strip */}
      <div className="mb-6">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">Inspiration — click to try</p>
        <div
          className="overflow-hidden"
          onMouseEnter={() => setMarqueePaused(true)}
          onMouseLeave={() => setMarqueePaused(false)}
        >
          <div
            className="flex gap-3"
            style={{
              width: 'max-content',
              animation: 'marquee 40s linear infinite',
              animationPlayState: marqueePaused ? 'paused' : 'running',
            }}
          >
            {[...INSPIRATION_EXAMPLES, ...INSPIRATION_EXAMPLES].map((ex, i) => (
              <button
                key={i}
                onClick={() => {
                  setActiveTab(ex.tab);
                  setStyle(ex.style as any);
                  setPrompt(ex.prompt);
                  document.getElementById('generator-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex-shrink-0 w-48 h-32 rounded-xl bg-gradient-to-br ${ex.gradient} relative overflow-hidden text-left transition-transform duration-300 hover:scale-105`}
              >
                <div className="absolute inset-0 bg-black/20 hover:bg-black/10 transition-colors" />
                <div className="absolute bottom-0 left-0 right-0 p-2.5 bg-gradient-to-t from-black/75 to-transparent">
                  <span className="block text-[10px] font-bold text-white/70 uppercase tracking-wider mb-0.5">{ex.label}</span>
                  <span className="block text-xs text-white font-medium leading-tight line-clamp-2">{ex.prompt}</span>
                </div>
                <div className="absolute top-2 right-2">
                  <span className="text-[9px] bg-white/20 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">{ex.style}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card id="generator-card" className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-6 w-6 text-primary" />Generator</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                  <TabsTrigger value="text-to-video">Text to Video</TabsTrigger>
                  <TabsTrigger value="image-to-video">Image to Video</TabsTrigger>
                  <TabsTrigger value="image-to-image">Image to Image</TabsTrigger>
                  <TabsTrigger value="text-to-image">Text to Image</TabsTrigger>
                </TabsList>
                
                <TabsContent value="text-to-video" className="space-y-4 pt-4">
                  <div>
                    <Label htmlFor="prompt">Prompt</Label>
                    <Textarea
                      id="prompt"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g., A cyberpunk street in the rain, neon signs reflecting on wet pavement"
                      disabled={isGenerating}
                      rows={2}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="image-to-video" className="space-y-4 pt-4">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <div className="space-y-2">
                      <Label htmlFor="image-upload-video">Source Image</Label>
                      <Input id="image-upload-video" type="file" accept="image/png, image/jpeg" onChange={handleImageFileChange} disabled={isGenerating} />
                    </div>
                    {imagePreview && (
                      <div className="flex justify-center items-center p-2 border rounded-md bg-muted">
                        <Image src={imagePreview} alt="Image Preview" width={150} height={150} className="rounded-md object-contain max-h-32" />
                      </div>
                    )}
                   </div>
                   <div>
                    <Label htmlFor="image-prompt-video">Animation Prompt</Label>
                    <Textarea
                      id="image-prompt-video"
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      placeholder="e.g., Make the character subtly smile, make the background lights flicker"
                      disabled={isGenerating}
                      rows={2}
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="image-to-image" className="space-y-4 pt-4">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <div className="space-y-2">
                      <Label htmlFor="image-upload-image">Source Image</Label>
                      <Input id="image-upload-image" type="file" accept="image/png, image/jpeg" onChange={handleImageFileChange} disabled={isGenerating} />
                    </div>
                    {imagePreview && (
                      <div className="flex justify-center items-center p-2 border rounded-md bg-muted">
                        <Image src={imagePreview} alt="Image Preview" width={150} height={150} className="rounded-md object-contain max-h-32" />
                      </div>
                    )}
                   </div>
                   <div>
                    <Label htmlFor="image-prompt-image">Edit Prompt</Label>
                    <Textarea
                      id="image-prompt-image"
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      placeholder="e.g., Change the background to a jungle, make the character wear a hat"
                      disabled={isGenerating}
                      rows={2}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="text-to-image" className="space-y-4 pt-4">
                  <div>
                    <Label htmlFor="text-to-image-prompt">Prompt</Label>
                    <Textarea
                      id="text-to-image-prompt"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g., A serene mountain lake at sunrise, photorealistic, golden light"
                      disabled={isGenerating}
                      rows={2}
                    />
                  </div>
                </TabsContent>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                    <div className="md:col-span-1">
                      <Label htmlFor="style">Style</Label>
                      <Select value={style} onValueChange={(value) => setStyle(value as any)} disabled={isGenerating}>
                        <SelectTrigger id="style"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {styleOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-1">
                      <Label>Orientation</Label>
                      <RadioGroup
                        value={orientation}
                        onValueChange={(value) => setOrientation(value as any)}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2"
                        disabled={isGenerating}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="16:9" id="orientation-h" />
                          <Label htmlFor="orientation-h" className="flex items-center gap-1 cursor-pointer"><Monitor className="h-4 w-4"/> Horizontal</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="9:16" id="orientation-v" />
                          <Label htmlFor="orientation-v" className="flex items-center gap-1 cursor-pointer"><Smartphone className="h-4 w-4"/> Vertical</Label>
                        </div>
                        {(activeTab === 'image-to-image' || activeTab === 'text-to-image') && (
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="1:1" id="orientation-s" />
                            <Label htmlFor="orientation-s" className="flex items-center gap-1 cursor-pointer"><Camera className="h-4 w-4"/> Square</Label>
                          </div>
                        )}
                      </RadioGroup>
                    </div>
                    <div className="md:col-span-1">
                      <Label htmlFor="character">Character (Optional)</Label>
                      <Select value={selectedCharacterId} onValueChange={setSelectedCharacterId} disabled={isGenerating}>
                        <SelectTrigger id="character"><SelectValue placeholder="Select a character..." /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">No character</SelectItem>
                            {characters.map(char => (
                                <SelectItem key={char.id} value={char.id}>{char.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-6">
                    {canAfford ? (
                      <Button onClick={handleGeneration} disabled={isGenerateButtonDisabled}>
                        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        {(activeTab === 'image-to-image' || activeTab === 'text-to-image') ? `Generate Image (${cost} Credit)` : `Spawn Scene (${cost} Credits)`}
                      </Button>
                    ) : (
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <Button disabled={isProcessingPayment}>
                                {isProcessingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                Top Up Credits
                              </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                              <AlertDialogHeader>
                                  <AlertDialogTitle>Out of Credits!</AlertDialogTitle>
                                  <AlertDialogDescription>Choose a credit pack to continue generating.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <div className="space-y-4 py-4">
                                  <Button className="w-full justify-between h-auto py-3" variant="outline" onClick={() => handlePurchaseCredits('starter')} disabled={isProcessingPayment}>
                                      <div><p className="font-semibold">Starter Pack</p><p className="font-normal text-sm">250 Credits (~25 videos)</p></div>
                                      <p className="text-lg font-semibold">$15</p>
                                  </Button>
                                  <Button className="w-full justify-between h-auto py-3" variant="outline" onClick={() => handlePurchaseCredits('agency')} disabled={isProcessingPayment}>
                                      <div><p className="font-semibold">Agency Pack</p><p className="font-normal text-sm">1000 Credits (~100 videos)</p></div>
                                      <p className="text-lg font-semibold">$50</p>
                                  </Button>
                              </div>
                              <AlertDialogFooter>
                                  <AlertDialogCancel disabled={isProcessingPayment}>Cancel</AlertDialogCancel>
                              </AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <p className="text-sm text-muted-foreground">You have {credits} {credits === 1 ? 'credit' : 'credits'} left.</p>
                </div>
              </Tabs>
            </CardContent>
          </Card>
          
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Video className="h-6 w-6 text-primary" />Generated Media</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center bg-black rounded-b-lg aspect-video">
              {isGenerating ? (
                <div className="text-center text-primary-foreground">
                  <Loader2 className="h-12 w-12 animate-spin mx-auto" />
                  <p className="mt-4">Generating... may take up to 2 mins</p>
                </div>
              ) : generatedMedia ? (
                <div className="relative w-full h-full">
                  {generatedMedia.type === 'video' ? (
                     <video src={generatedMedia.url} controls autoPlay loop className="w-full h-full object-contain" />
                  ) : (
                     <Image src={generatedMedia.url} alt="Generated Image" fill className="object-contain" />
                  )}
                  <Button asChild size="sm" className="absolute top-2 right-2">
                    <a href={generatedMedia.url} download target="_blank" rel="noopener noreferrer">
                      <Download className="mr-2 h-4 w-4" /> Download
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <p>Your generated video or image will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1 space-y-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" />My Characters</CardTitle>
              <CardDescription>Create and manage reusable characters for your scenes.</CardDescription>
            </CardHeader>
            <CardContent>
                <AlertDialog open={!!characterToDelete} onOpenChange={(open) => !open && setCharacterToDelete(null)}>
                    <div className="space-y-2 mb-4 max-h-48 overflow-y-auto pr-2">
                        {characters.length > 0 ? characters.map(char => (
                            <div key={char.id} className="p-3 border rounded-md text-sm bg-muted/50 flex justify-between items-center">
                                <div>
                                    <p className="font-semibold">{char.name}</p>
                                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">{char.description}</p>
                                </div>
                                <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive/70 hover:text-destructive flex-shrink-0" onClick={() => setCharacterToDelete(char)}>
                                    <Trash2 className="h-4 w-4"/>
                                </Button>
                                </AlertDialogTrigger>
                            </div>
                        )) : <p className="text-center text-muted-foreground py-3 text-sm">No characters created yet.</p>}
                    </div>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently delete the character "{characterToDelete?.name}". This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isDeletingCharacter}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteCharacter} disabled={isDeletingCharacter} className="bg-destructive hover:bg-destructive/90">
                                {isDeletingCharacter && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
              <Dialog open={isCharacterDialogOpen} onOpenChange={setIsCharacterDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full">
                    <PlusCircle className="mr-2 h-4 w-4" /> Create New Character
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create a New Character</DialogTitle>
                    <DialogDescription>
                      Define a character that you can reuse in different scenes. Provide a name and a detailed description.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label htmlFor="char-name">Character Name</Label>
                      <Input id="char-name" value={newCharacterName} onChange={(e) => setNewCharacterName(e.target.value)} placeholder="e.g., Captain Eva" disabled={isSavingCharacter} />
                    </div>
                    <div>
                      <Label htmlFor="char-desc">Description</Label>
                      <Textarea id="char-desc" value={newCharacterDescription} onChange={(e) => setNewCharacterDescription(e.target.value)} placeholder="e.g., A space pirate with a robotic arm and a sarcastic parrot on her shoulder." rows={4} disabled={isSavingCharacter} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCharacterDialogOpen(false)} disabled={isSavingCharacter}>Cancel</Button>
                    <Button onClick={handleSaveCharacter} disabled={isSavingCharacter || !newCharacterName.trim() || !newCharacterDescription.trim()}>
                        {isSavingCharacter && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Save Character
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />History</CardTitle>
              <CardDescription>Your previously generated media.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh_-_30rem)]">
                {isLoadingHistory ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div>
                 : history.length > 0 ? (
                  <div className="space-y-4">
                    {history.map(item => (
                      <div key={item.id} className="p-3 border rounded-md hover:bg-muted/50 cursor-pointer" onClick={() => setGeneratedMedia({ url: (item.videoUrl || item.imageUrl)!, type: item.videoUrl ? 'video' : 'image' })}>
                        <p className="text-sm truncate">{item.prompt}</p>
                        <p className="text-xs text-muted-foreground flex items-center justify-between">
                          <span>{item.style} • {item.imageUrl ? 'Image' : 'Video'} • {item.orientation || 'N/A'}</span>
                          <span>{formatDistanceToNow(item.timestamp.toDate(), { addSuffix: true })}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                 ) : <p className="text-center text-muted-foreground py-6">No history yet.</p>}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function SceneSpawnerPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
      <SceneSpawnerContent />
    </Suspense>
  );
}
