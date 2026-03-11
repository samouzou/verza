'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserProfileFirestoreData } from '@/types';
import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Mail, Users, BarChart, ArrowLeft, BadgeCheck, Sparkles, Star, Instagram, Youtube } from 'lucide-react';
import Link from 'next/link';

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
  >
    <path d="M19.589 6.686a4.793 4.83 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743 2.897 2.897 0 0 1 3.103-4.532V9.424a7.274 7.274 0 0 0-7.274 7.243 7.274 7.274 0 0 0 14.548 0V8.308a8.294 8.294 0 0 0 5.33 3.442V8.308a4.83 4.83 0 0 1-3.291-1.622z" />
  </svg>
);

const formatFollowers = (num: number) => {
    if (!num) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.floor(num / 1000)}K`;
    return num.toString();
};

export default function CreatorProfilePage() {
  const params = useParams();
  const router = useRouter();
  const creatorId = params.id as string;
  const [creator, setCreator] = useState<UserProfileFirestoreData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (creatorId) {
      const fetchCreator = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const userDocRef = doc(db, 'users', creatorId);
          const docSnap = await getDoc(userDocRef);

          if (docSnap.exists() && docSnap.data().showInMarketplace === true) {
            setCreator(docSnap.data() as UserProfileFirestoreData);
          } else {
            setError("Creator profile not found or is not public.");
          }
        } catch (err) {
          console.error("Error fetching creator profile:", err);
          setError("Failed to load creator profile.");
        } finally {
          setIsLoading(false);
        }
      };
      fetchCreator();
    }
  }, [creatorId]);

  if (isLoading) {
    return <div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (error) {
    return <div className="text-center py-10 text-destructive">{error}</div>;
  }
  
  if (!creator) {
    return null;
  }

  const isVerified = creator.instagramConnected || creator.tiktokConnected || creator.youtubeConnected;

  return (
    <>
      <PageHeader 
        title={creator.displayName || "Creator Profile"} 
        description={creator.niche || "Content Creator"}
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4"/> Back
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <Card className="overflow-hidden border-primary/10">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Avatar className="h-32 w-32 mb-4 border-4 border-primary/20 relative">
                <AvatarImage src={creator.avatarUrl || ''} alt={creator.displayName || 'Creator'} />
                <AvatarFallback className="text-4xl">{creator.displayName?.charAt(0) || 'C'}</AvatarFallback>
                {isVerified && (
                    <div className="absolute bottom-0 right-0 bg-primary text-white p-1.5 rounded-full border-4 border-background">
                        <BadgeCheck className="h-5 w-5" />
                    </div>
                )}
              </Avatar>
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold">{creator.displayName}</h2>
                    {isVerified && <BadgeCheck className="h-5 w-5 text-primary" />}
                </div>
                <div className="flex items-center gap-3 py-1">
                    {creator.instagramConnected && <Instagram className="h-5 w-5 text-pink-500" />}
                    {creator.youtubeConnected && <Youtube className="h-5 w-5 text-red-500" />}
                    {creator.tiktokConnected && <TikTokIcon className="h-5 w-5 text-foreground" />}
                </div>
              </div>
              <Badge variant="outline" className="mt-2 text-muted-foreground font-normal">{creator.contentType || 'General'}</Badge>
              
              <div className="flex justify-around w-full mt-6 pt-6 border-t">
                <div className="text-center">
                  <p className="font-bold text-xl flex items-center justify-center gap-1"><Users className="h-5 w-5 text-muted-foreground" /> {formatFollowers(creator.followers || 0)}</p>
                  <p className="text-xs text-muted-foreground">Followers</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-xl flex items-center justify-center gap-1"><BarChart className="h-5 w-5 text-muted-foreground" /> {creator.engagementRate || 0}%</p>
                  <p className="text-xs text-muted-foreground">Engagement</p>
                </div>
              </div>
              <Button asChild className="w-full mt-6">
                <a href={`mailto:${creator.email}`}>
                  <Mail className="mr-2 h-4 w-4" /> Reach Out
                </a>
              </Button>
            </CardContent>
          </Card>

          {creator.brandWishlist && creator.brandWishlist.length > 0 && (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                        <Star className="h-4 w-4" /> Target Collaborations
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {creator.brandWishlist.map((brand, i) => (
                            <Badge key={i} variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">{brand}</Badge>
                        ))}
                    </div>
                </CardContent>
            </Card>
          )}
        </div>

        <div className="md:col-span-2 space-y-6">
            {(creator.missionStatement || creator.niche) && (
                <Card className="bg-primary/5 border-primary/10">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary"/> Creator Mission</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {creator.missionStatement && (
                          <p className="text-xl italic font-medium text-primary/80">"{creator.missionStatement}"</p>
                        )}
                        {creator.niche && (
                          <div className="pt-2 border-t border-primary/10">
                            <p className="text-sm text-muted-foreground">{creator.niche}</p>
                          </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Content Showcase</CardTitle>
                    <CardDescription>A glimpse into the content style and aesthetic.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="aspect-square bg-muted rounded-lg flex items-center justify-center group hover:bg-muted/80 transition-colors cursor-pointer border border-border/50">
                            <p className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Project Portfolio</p>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
      </div>
    </>
  );
}
