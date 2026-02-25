
"use client";

import { useState, useMemo } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, ArrowLeft, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

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
  const [videosPerCreator, setVideosPerCreator] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalAmount = useMemo(() => {
    const rate = parseFloat(ratePerCreator);
    const needed = parseInt(creatorsNeeded, 10);
    if (!isNaN(rate) && !isNaN(needed) && rate > 0 && needed > 0) {
        return rate * needed;
    }
    return 0;
  }, [ratePerCreator, creatorsNeeded]);

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
    const videosNum = parseInt(videosPerCreator, 10);
    
    if (!title.trim() || !description.trim() || selectedPlatforms.length === 0 || isNaN(rateNum) || rateNum <= 0 || isNaN(creatorsNum) || creatorsNum <= 0 || isNaN(videosNum) || videosNum <= 0) {
      toast({ title: 'All fields are required', description: 'Please fill out the form completely.', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    toast({ title: "Redirecting to Payment", description: "Please complete the payment to post your gig." });
    
    try {
      const createCheckout = httpsCallable(functions, 'createGigFundingCheckoutSession');
      const result = await createCheckout({
        title: title.trim(),
        description: description.trim(),
        platforms: selectedPlatforms,
        ratePerCreator: rateNum,
        creatorsNeeded: creatorsNum,
        videosPerCreator: videosNum,
      });
      const data = result.data as { url?: string };
      if (data.url) {
          window.location.href = data.url;
      } else {
          throw new Error("Failed to get payment URL.");
      }
    } catch (error: any) {
        console.error("Error initiating gig funding:", error);
        toast({ title: 'Funding Failed', description: error.message || 'Could not initiate the funding process.', variant: 'destructive' });
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="rate">Rate per Creator ($)</Label>
                    <Input id="rate" type="number" value={ratePerCreator} onChange={e => setRatePerCreator(e.target.value)} placeholder="150" required min="1" disabled={isSubmitting}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="creators">Creators Needed</Label>
                    <Input id="creators" type="number" value={creatorsNeeded} onChange={e => setCreatorsNeeded(e.target.value)} placeholder="10" required min="1" disabled={isSubmitting}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="videos">Videos per Creator</Label>
                    <Input id="videos" type="number" value={videosPerCreator} onChange={e => setVideosPerCreator(e.target.value)} placeholder="1" required min="1" disabled={isSubmitting}/>
                </div>
            </div>

            {totalAmount > 0 && (
              <div className="p-4 border rounded-lg bg-muted text-center">
                <p className="text-sm text-muted-foreground">Total Project Funding</p>
                <p className="text-3xl font-bold">${totalAmount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">({creatorsNeeded} creators x ${ratePerCreator})</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting || totalAmount <= 0}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
              Fund & Post Gig
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
