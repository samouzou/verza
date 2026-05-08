"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Palette, MessageSquare, Plus, Trash2, Save, Type } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import type { Agency, BrandGuide } from '@/types';
import { ImageUpload } from '@/components/ui/image-upload';
import { BrandDeckPreview } from '@/components/agency/brand-deck-preview';

export default function BrandGuidePage() {
  const { user, isLoading: authLoading } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [guide, setGuide] = useState<BrandGuide>({
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
    logoUrl: '',
    typography: '',
    toneOfVoice: '',
    dos: [],
    donts: [],
    assetDriveUrl: '',
  });

  useEffect(() => {
    if (!user?.primaryAgencyId) {
      if (!authLoading) setLoading(false);
      return;
    }

    const fetchAgency = async () => {
      try {
        const agencyRef = doc(db, 'agencies', user.primaryAgencyId!);
        const snap = await getDoc(agencyRef);
        if (snap.exists()) {
          const data = snap.data() as Agency;
          setAgency(data);
          if (data.brandGuide) {
            setGuide({
              ...guide,
              ...data.brandGuide,
              dos: data.brandGuide.dos || [],
              donts: data.brandGuide.donts || [],
            });
          }
        }
      } catch (error) {
        console.error("Error fetching agency:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAgency();
  }, [user, authLoading]);

  const handleSave = async () => {
    if (!user?.primaryAgencyId) return;
    setSaving(true);
    try {
      const agencyRef = doc(db, 'agencies', user.primaryAgencyId);
      await updateDoc(agencyRef, {
        brandGuide: guide,
        updatedAt: new Date(),
      });
      toast({ title: "Brand Guide Saved", description: "Your brand guidelines have been updated successfully." });
    } catch (error: any) {
      console.error("Error saving brand guide:", error);
      toast({ title: "Save Failed", description: error.message || "Could not save brand guide.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addItem = (field: 'dos' | 'donts') => {
    setGuide({ ...guide, [field]: [...(guide[field] || []), ''] });
  };

  const removeItem = (field: 'dos' | 'donts', index: number) => {
    const newList = [...(guide[field] || [])];
    newList.splice(index, 1);
    setGuide({ ...guide, [field]: newList });
  };

  const updateItem = (field: 'dos' | 'donts', index: number, value: string) => {
    const newList = [...(guide[field] || [])];
    newList[index] = value;
    setGuide({ ...guide, [field]: newList });
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user?.isBrandAccount) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-semibold">Brand Guide is only available for Brand accounts.</h2>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <PageHeader 
        title="Brand Guide" 
        description="Define your identity and watch your Brand Deck update live."
        actions={
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        }
      />

      <div className="flex-1 flex gap-8 overflow-hidden pt-4">
        {/* Left Side: Configuration (Scrollable) */}
        <div className="flex-1 overflow-y-auto pr-4 space-y-6 pb-20 scrollbar-thin">
           {/* Visual Identity */}
           <Card className="border-none shadow-none bg-transparent">
              <CardHeader className="px-0">
                <CardTitle className="flex items-center gap-2 text-xl font-bold">
                  <Palette className="h-5 w-5 text-primary" />
                  Visual Identity
                </CardTitle>
                <CardDescription>Logo, Colors, and Typography</CardDescription>
              </CardHeader>
              <CardContent className="px-0 space-y-6">
                <div className="space-y-3">
                   <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Brand Logo</Label>
                   <ImageUpload 
                      value={guide.logoUrl} 
                      onChange={(url) => setGuide({ ...guide, logoUrl: url })}
                      onRemove={() => setGuide({ ...guide, logoUrl: '' })}
                      label="Upload Logo"
                   />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label htmlFor="primaryColor" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Primary Color</Label>
                    <div className="flex gap-2">
                      <Input 
                        id="primaryColor" 
                        type="color" 
                        value={guide.primaryColor} 
                        onChange={(e) => setGuide({ ...guide, primaryColor: e.target.value })}
                        className="w-12 p-1 h-10 rounded-lg cursor-pointer border-none shadow-sm"
                      />
                      <Input 
                        value={guide.primaryColor} 
                        onChange={(e) => setGuide({ ...guide, primaryColor: e.target.value })}
                        placeholder="#000000"
                        className="font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Label htmlFor="secondaryColor" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Secondary Color</Label>
                    <div className="flex gap-2">
                      <Input 
                        id="secondaryColor" 
                        type="color" 
                        value={guide.secondaryColor} 
                        onChange={(e) => setGuide({ ...guide, secondaryColor: e.target.value })}
                        className="w-12 p-1 h-10 rounded-lg cursor-pointer border-none shadow-sm"
                      />
                      <Input 
                        value={guide.secondaryColor} 
                        onChange={(e) => setGuide({ ...guide, secondaryColor: e.target.value })}
                        placeholder="#ffffff"
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="typography" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <Type className="h-4 w-4" />
                    Typography
                  </Label>
                  <Input 
                    id="typography" 
                    value={guide.typography} 
                    onChange={(e) => setGuide({ ...guide, typography: e.target.value })}
                    placeholder="e.g. Inter, Outfit, Montserrat"
                  />
                </div>
              </CardContent>
           </Card>

           {/* Brand Voice */}
           <Card className="border-none shadow-none bg-transparent">
              <CardHeader className="px-0">
                <CardTitle className="flex items-center gap-2 text-xl font-bold">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  Brand Voice
                </CardTitle>
                <CardDescription>Tone of voice and b-roll assets</CardDescription>
              </CardHeader>
              <CardContent className="px-0 space-y-6">
                <div className="space-y-3">
                  <Label htmlFor="toneOfVoice" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tone of Voice Description</Label>
                  <Textarea 
                    id="toneOfVoice" 
                    value={guide.toneOfVoice} 
                    onChange={(e) => setGuide({ ...guide, toneOfVoice: e.target.value })}
                    placeholder="Describe your brand persona..."
                    className="min-h-[120px] rounded-xl shadow-sm"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-green-600 font-bold uppercase tracking-wider text-[10px]">Dos</Label>
                      <Button variant="ghost" size="sm" onClick={() => addItem('dos')} className="h-6 text-[10px] hover:bg-green-50">
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {guide.dos?.map((item, index) => (
                        <div key={index} className="flex gap-2 group">
                          <Input 
                            value={item} 
                            onChange={(e) => updateItem('dos', index, e.target.value)}
                            placeholder="e.g. Use natural lighting"
                            className="h-9 text-sm shadow-sm"
                          />
                          <Button variant="ghost" size="icon" onClick={() => removeItem('dos', index)} className="h-9 w-9 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-red-600 font-bold uppercase tracking-wider text-[10px]">Don'ts</Label>
                      <Button variant="ghost" size="sm" onClick={() => addItem('donts')} className="h-6 text-[10px] hover:bg-red-50">
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {guide.donts?.map((item, index) => (
                        <div key={index} className="flex gap-2 group">
                          <Input 
                            value={item} 
                            onChange={(e) => updateItem('donts', index, e.target.value)}
                            placeholder="e.g. Don't use filters"
                            className="h-9 text-sm shadow-sm"
                          />
                          <Button variant="ghost" size="icon" onClick={() => removeItem('donts', index)} className="h-9 w-9 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-6">
                  <Label htmlFor="assetDriveUrl" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">B-Roll Drive Link (Optional)</Label>
                  <Input 
                    id="assetDriveUrl" 
                    value={guide.assetDriveUrl} 
                    onChange={(e) => setGuide({ ...guide, assetDriveUrl: e.target.value })}
                    placeholder="Link to shared folder (Drive, Dropbox, etc)"
                    className="shadow-sm"
                  />
                </div>
              </CardContent>
           </Card>
        </div>

        {/* Right Side: Live Deck Preview (Sticky/Fixed in flex container) */}
        <div className="hidden lg:block w-[450px] shrink-0 pb-8">
           <BrandDeckPreview 
              guide={guide} 
              agencyName={agency?.name || 'Your Brand'} 
              products={agency?.products || []}
           />
        </div>
      </div>
    </div>
  );
}
