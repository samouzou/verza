
"use client";

import type { CreatorMarketplaceProfile } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, BarChart, Instagram, Youtube, BadgeCheck } from 'lucide-react';
import Link from 'next/link';

const TikTokIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.35 1.92-3.58 3.17-5.91 3.21-2.43.05-4.86-.45-6.6-1.8-1.49-1.15-2.55-2.88-2.9-4.75-.24-1.25-.3-2.5-.3-3.75.02-3.48-.02-6.96.02-10.43.01-1.49.53-2.96 1.5-4.04 1.04-1.14 2.56-1.74 4.13-1.82.08-.01.15-.01.23-.01.02.52.01 1.05-.01 1.57-.21.53-.41 1.07-.63 1.6-.22.53-.46 1.05-.69 1.58-.04.1-.06.21-.07.32.02.05.04.09.06.13.25.5.53.98.83 1.44.31.47.65.92 1 1.35.02.02.04.04.05.06.02.04.02.09.01.14-.24 1.52-.52 3.03-.78 4.55-.01.05-.02.11-.02.16-.21-.05-.42-.09-.63-.15-.53-.15-1.07-.26-1.6-.42-.53-.16-1.07-.28-1.6-.45-.29-.09-.58-.15-.88-.23-.02-3.13.01-6.27-.02-9.4.04-.52.12-1.03.23-1.54.11-.5.25-1 .41-1.48.11-.33.24-.65.38-.97.16-.35.34-.69.54-1.03.02-.04.05-.07.08-.1.02.01.05.01.07.02z"/>
    </svg>
);

interface CreatorCardProps {
    creator: CreatorMarketplaceProfile;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const formatFollowers = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.floor(num / 1000)}K`;
    return num.toString();
  };

  const isVerified = creator.instagramConnected || creator.tiktokConnected || creator.youtubeConnected;

  return (
    <Link href={`/creator/${creator.id}`} className="block">
      <Card className="hover:shadow-lg hover:border-primary/50 transition-all duration-200 h-full flex flex-col group">
        <CardHeader className="items-center text-center p-4 pb-2">
          <Avatar className="h-24 w-24 mb-3 border-2 border-primary/20 relative">
            <AvatarImage src={creator.avatarUrl} alt={creator.name} data-ai-hint="person" />
            <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
            {isVerified && (
                <div className="absolute -bottom-1 -right-1 bg-primary text-white p-1 rounded-full border-2 border-background">
                    <BadgeCheck className="h-4 w-4" />
                </div>
            )}
          </Avatar>
          <CardTitle className="text-lg line-clamp-1 group-hover:text-primary transition-colors">{creator.name}</CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className="font-normal">{creator.contentType}</Badge>
            <div className="flex items-center gap-1">
                {creator.instagramConnected && <Instagram className="h-3.5 w-3.5 text-pink-500" />}
                {creator.youtubeConnected && <Youtube className="h-3.5 w-3.5 text-red-500" />}
                {creator.tiktokConnected && <span className="text-foreground"><TikTokIcon /></span>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-center p-4 pt-0 flex-grow flex flex-col">
          <div className="flex-grow">
            <p className="text-sm text-muted-foreground mb-4 line-clamp-3 min-h-[3rem] leading-relaxed">
              {creator.niche}
            </p>
          </div>
          <div className="border-t pt-4">
            <div className="flex justify-around mb-4">
              <div className="text-center">
                <p className="font-bold text-base flex items-center justify-center gap-1">
                  <Users className="h-4 w-4 text-muted-foreground" /> 
                  {formatFollowers(creator.followers)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Followers</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-base flex items-center justify-center gap-1">
                  <BarChart className="h-4 w-4 text-muted-foreground" /> 
                  {creator.engagementRate.toFixed(1)}%
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Engagement</p>
              </div>
            </div>
            <Button className="w-full" variant="outline">View Profile</Button>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
