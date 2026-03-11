
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

const TikTokIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.35 1.92-3.58 3.17-5.91 3.21-2.43.05-4.86-.45-6.6-1.8-1.49-1.15-2.55-2.88-2.9-4.75-.24-1.25-.3-2.5-.3-3.75.02-3.48-.02-6.96.02-10.43.01-1.49.53-2.96 1.5-4.04 1.04-1.14 2.56-1.74 4.13-1.82.08-.01.15-.01.23-.01.02.52.01 1.05-.01 1.57-.21.53-.41 1.07-.63 1.6-.22.53-.46 1.05-.69 1.58-.04.1-.06.21-.07.32.02.05.04.09.06.13.25.5.53.98.83 1.44.31.47.65.92 1 1.35.02.02.04.04.05.06.02.04.02.09.01.14-.24 1.52-.52 3.03-.78 4.55-.01.05-.02.11-.02.16-.21-.05-.42-.09-.63-.15-.53-.15-1.07-.26-1.6-.42-.53-.16-1.07-.28-1.6-.45-.29-.09-.58-.15-.88-.23-.02-3.13.01-6.27-.02-9.4.04-.52.12-1.03.23-1.54.11-.5.25-1 .41-1.48.11-.33.24-.65.38-.97.16-.35.34-.69.54-1.03.02-.04.05-.07.08-.1.02.01.05.01.07.02z"/>
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
                    {creator.tiktokConnected && <span className="text-foreground"><TikTokIcon /></span>}
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
