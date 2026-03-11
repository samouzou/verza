
"use client";

import type { CreatorMarketplaceProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, BarChart } from 'lucide-react';
import Image from "next/image";
import Link from 'next/link';

interface CreatorCardProps {
    creator: CreatorMarketplaceProfile;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const formatFollowers = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.floor(num / 1000)}K`;
    return num.toString();
  };

  return (
    <Link href={`/creator/${creator.id}`} className="block">
      <Card className="hover:shadow-lg hover:border-primary/50 transition-all duration-200 h-full flex flex-col">
        <CardHeader className="items-center text-center p-4 pb-2">
          <Avatar className="h-24 w-24 mb-3 border-2 border-primary/20">
            <AvatarImage src={creator.avatarUrl} alt={creator.name} data-ai-hint="person" />
            <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <CardTitle className="text-lg line-clamp-1">{creator.name}</CardTitle>
          <Badge variant="secondary" className="font-normal mt-1">{creator.contentType}</Badge>
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
