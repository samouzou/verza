
"use client";

import { useState } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { collection, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Agency } from '@/types';

const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook'];

export default function PostGigPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [ratePerCreator, setRatePerCreator] = useState('');
  const [creatorsNeeded, setCreatorsNeeded] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handlePlatformChange = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.primaryAgencyId) {
        toast({ title: 'Authentication or Agency Error', description: "You must be associated with an agency to post a gig.", variant: 'destructive' });
        return;
    }
    
    const rateNum = parseFloat(ratePerCreator);
    const creatorsNum = parseInt(creatorsNeeded, 10);
    
    if (!title.trim() || !description.trim() || selectedPlatforms.length === 0 || isNaN(rateNum) || rateNum <= 0 || isNaN(creatorsNum) || creatorsNum <= 0) {
      toast({ title: 'All fields are required', description: 'Please fill out the form completely.', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      const agencyDocRef = doc(db, "agencies", user.primaryAgencyId);
      const agencySnap = await getDoc(agencyDocRef);
      const brandName = agencySnap.exists() ? (agencySnap.data() as Agency).name : user.displayName || 'Anonymous Brand';

      const gigData = {
        brandId: user.primaryAgencyId,
        brandName: brandName,
        brandLogoUrl: user.companyLogoUrl || null,
        title: title.trim(),
        description: description.trim(),
        platforms: selectedPlatforms,
        ratePerCreator: rateNum,
        creatorsNeeded: creatorsNum,
        acceptedCreatorIds: [],
        status: 'open',
        createdAt: serverTimestamp(),
      };
      
      await addDoc(collection(db, 'gigs'), gigData);
      
      toast({ title: 'Gig Posted!', description: 'Your gig is now live on the Gig Board.' });
      router.push('/gigs');

    } catch (error: any) {
        console.error("Error posting gig:", error);
        toast({ title: 'Submission Failed', description: error.message || 'Could not post your gig.', variant: 'destructive' });
    } finally {
        setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  
  const canPostGig = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';

  if (!user || !canPostGig) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Only agency team members can post new gigs.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Post a New Gig"
        description="Describe your project, set your rate, and find creators."
        actions={
            <Button variant="outline" asChild>
                <Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Cancel</Link>
            </Button>
        }
      />
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
            <CardTitle>Gig Details</CardTitle>
            <CardDescription>Fill out the details for your user-generated content (UGC) campaign.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="title">Gig Title</Label>
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Unboxing Video for Skincare Product" required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="description">Project Description</Label>
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the content you need, key talking points, and any do's or don'ts." rows={5} required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label>Platforms</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                {platforms.map(platform => (
                  <div key={platform} className="flex items-center space-x-2">
                    <Checkbox
                      id={`platform-${platform}`}
                      checked={selectedPlatforms.includes(platform)}
                      onCheckedChange={() => handlePlatformChange(platform)}
                      disabled={isSubmitting}
                    />
                    <Label htmlFor={`platform-${platform}`} className="font-normal">{platform}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="rate">Rate per Creator ($)</Label>
                    <Input id="rate" type="number" value={ratePerCreator} onChange={e => setRatePerCreator(e.target.value)} placeholder="150" required min="1" disabled={isSubmitting}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="creators">Number of Creators Needed</Label>
                    <Input id="creators" type="number" value={creatorsNeeded} onChange={e => setCreatorsNeeded(e.target.value)} placeholder="10" required min="1" disabled={isSubmitting}/>
                </div>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post Gig & Fund Project
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
