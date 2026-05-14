
"use client";

import type { CreatorMarketplaceProfile } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, BarChart, Instagram, Youtube, BadgeCheck, Flame } from 'lucide-react';
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

  const platforms = [
    { 
      id: 'instagram', 
      connected: creator.instagramConnected, 
      followers: creator.instagramFollowers, 
      engagement: creator.instagramEngagement, 
      icon: Instagram, 
      color: 'text-pink-500',
      label: 'Followers'
    },
    { 
      id: 'tiktok', 
      connected: creator.tiktokConnected, 
      followers: creator.tiktokFollowers, 
      engagement: creator.tiktokEngagement, 
      icon: TikTokIcon, 
      color: 'text-foreground',
      label: 'Followers'
    },
    { 
      id: 'youtube', 
      connected: creator.youtubeConnected, 
      followers: creator.youtubeFollowers, 
      engagement: creator.youtubeEngagement, 
      icon: Youtube, 
      color: 'text-red-500',
      label: 'Subscribers'
    }
  ].filter(p => p.connected);

  return (
    <Link href={`/creator/${creator.id}`} className="block">
      <Card className="hover:shadow-lg hover:border-primary/50 transition-all duration-200 h-full flex flex-col group">
        <CardHeader className="items-center text-center p-4 pb-2 relative">
          {creator.averageVerzaScore !== undefined && creator.averageVerzaScore > 0 && (
            <div className="absolute top-4 right-4 flex items-center gap-1">
              <Flame className="h-4 w-4 text-orange-500 fill-orange-500" />
              <span className="text-xs font-bold">{creator.averageVerzaScore}%</span>
            </div>
          )}
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
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 flex-grow flex flex-col">
          <div className="flex-grow">
            <p className="text-sm text-muted-foreground mb-4 line-clamp-3 min-h-[3rem] leading-relaxed text-center">
              {creator.niche}
            </p>
          </div>
          
          <div className="border-t pt-4 space-y-3">
            {platforms.length > 0 ? (
              platforms.map(platform => (
                <div key={platform.id} className="flex items-center justify-between bg-muted/30 p-2 rounded-md">
                  <div className="flex items-center gap-2">
                    <platform.icon className={`h-4 w-4 ${platform.color}`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">{platform.id}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs font-bold leading-tight">{formatFollowers(platform.followers || 0)}</p>
                      <p className="text-[8px] text-muted-foreground uppercase">{platform.label}</p>
                    </div>
                    <div className="text-right border-l pl-3">
                      <p className="text-xs font-bold leading-tight">{platform.engagement?.toFixed(1) || '0'}%</p>
                      <p className="text-[8px] text-muted-foreground uppercase">Eng.</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-2">
                <p className="text-[10px] text-muted-foreground italic">No platforms connected</p>
              </div>
            )}
            <Button className="w-full mt-2" variant="outline">View Profile</Button>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
