"use client";

import type { CreatorMarketplaceProfile } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, BarChart, Instagram, Youtube, BadgeCheck } from 'lucide-react';
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
                {creator.tiktokConnected && <TikTokIcon className="h-3.5 w-3.5 text-foreground" />}
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
