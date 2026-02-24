
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserProfileFirestoreData } from '@/types';
import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Mail, Users, BarChart, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

// Mock stats for now
const formatFollowers = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.floor(num / 1000)}K`;
    return num.toString();
};

export default function CreatorProfilePage() {
  const params = useParams();
  const creatorId = params.id as string;
  const [creator, setCreator] = useState<UserProfileFirestoreData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mocked stats
  const [followers, setFollowers] = useState(0);
  const [engagementRate, setEngagementRate] = useState(0);


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
            // Mock stats when data is loaded
            setFollowers(Math.floor(Math.random() * (500000 - 5000) + 5000));
            setEngagementRate(parseFloat((Math.random() * (8 - 1.5) + 1.5).toFixed(1)));
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

  return (
    <>
      <PageHeader 
        title={creator.displayName || "Creator Profile"} 
        description={creator.niche || "Content Creator"}
        actions={<Button variant="outline" asChild><Link href="/marketplace"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Marketplace</Link></Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <Card>
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Avatar className="h-32 w-32 mb-4 border-4 border-primary/20">
                <AvatarImage src={creator.avatarUrl || ''} alt={creator.displayName || 'Creator'} />
                <AvatarFallback className="text-4xl">{creator.displayName?.charAt(0) || 'C'}</AvatarFallback>
              </Avatar>
              <h2 className="text-2xl font-bold">{creator.displayName}</h2>
              <Badge variant="secondary" className="mt-2">{creator.contentType}</Badge>
              <div className="flex justify-around w-full mt-6 pt-6 border-t">
                <div className="text-center">
                  <p className="font-bold text-xl flex items-center justify-center gap-1"><Users className="h-5 w-5 text-muted-foreground" /> {formatFollowers(followers)}</p>
                  <p className="text-xs text-muted-foreground">Followers</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-xl flex items-center justify-center gap-1"><BarChart className="h-5 w-5 text-muted-foreground" /> {engagementRate.toFixed(1)}%</p>
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
        </div>
        <div className="md:col-span-2">
            <Card>
                <CardHeader>
                    <CardTitle>Creator Content (Placeholder)</CardTitle>
                    <CardDescription>This area will showcase the creator's recent posts and collaborations.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                            <p className="text-sm text-muted-foreground">Content</p>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
      </div>
    </>
  );
}
