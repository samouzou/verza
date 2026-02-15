
"use client";

import { useState, useEffect, ChangeEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Video, Download, History, Monitor, Smartphone, Users, PlusCircle, Image as ImageIcon, Camera, Trash2 } from 'lucide-react';
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

const styleOptions = ["Anime", "3D Render", "Realistic", "Claymation"] as const;
const VIDEO_COST = 10;
const IMAGE_COST = 1;


export default function SceneSpawnerPage() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("text-to-video");
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
    const currentPrompt = mode === 'text-to-video' ? prompt : imagePrompt;
    const cost = mode === 'image-to-image' ? IMAGE_COST : VIDEO_COST;
    const credits = user.credits ?? 0;
    
    if (!currentPrompt.trim() || (mode !== 'text-to-video' && !imageFile)) {
      toast({ title: "Missing Input", description: `Please provide a prompt${mode !== 'text-to-video' ? ' and an image' : ''}.`, variant: "destructive" });
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
      
      if (mode === 'image-to-image') {
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


  const cost = activeTab === 'image-to-image' ? IMAGE_COST : VIDEO_COST;
  const credits = user?.credits ?? 0;
  const canAfford = credits >= cost;
  
  const isGenerateButtonDisabled = isGenerating ||
    (activeTab === 'text-to-video' && !prompt.trim()) ||
    (activeTab !== 'text-to-video' && (!imagePrompt.trim() || !imageFile));


  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  return (
    <>
      <PageHeader
        title="Scene Spawner"
        description="Generate video clips and images for your content using AI."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-6 w-6 text-primary" />Generator</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="text-to-video">Text to Video</TabsTrigger>
                  <TabsTrigger value="image-to-video">Image to Video</TabsTrigger>
                  <TabsTrigger value="image-to-image">Image to Image</TabsTrigger>
                </TabsList>
                
                <TabsContent value="text-to-video" className="space-y-4 pt-4">
                  <div>
                    <Label htmlFor="prompt">Prompt</Label>
                    <Input
                      id="prompt"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g., A cyberpunk street in the rain, neon signs reflecting on wet pavement"
                      disabled={isGenerating}
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
                        className="flex items-center gap-4 mt-2"
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
                         {activeTab === 'image-to-image' && (
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
                        {activeTab === 'image-to-image' ? `Generate Image (${cost} Credit)` : `Spawn Scene (${cost} Credits)`}
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
                     <Image src={generatedMedia.url} alt="Generated Image" layout="fill" className="object-contain" />
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
