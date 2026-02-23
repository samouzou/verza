"use client";

import { PageHeader } from "@/components/page-header";
import { CreatorCard } from "@/components/marketplace/creator-card";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CreatorMarketplaceProfile, UserProfileFirestoreData } from "@/types";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

export default function MarketplacePage() {
  const { toast } = useToast();
  const [creators, setCreators] = useState<CreatorMarketplaceProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");

  useEffect(() => {
    setIsLoading(true);
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('showInMarketplace', '==', true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const creatorsData = snapshot.docs.map(doc => {
        const data = doc.data() as UserProfileFirestoreData;
        
        // Ensure contentType is one of the allowed values, default if not.
        const validContentTypes: CreatorMarketplaceProfile['contentType'][] = ['Tech', 'Fashion', 'Comedy', 'Gaming', 'Lifestyle', 'Food'];
        const creatorContentType = data.contentType && validContentTypes.includes(data.contentType) ? data.contentType : 'Lifestyle';

        return {
          id: data.uid,
          name: data.displayName || 'Unnamed Creator',
          avatarUrl: data.avatarUrl || `https://picsum.photos/seed/${data.uid}/200`,
          niche: data.niche || 'Creator',
          contentType: creatorContentType,
          // Using mock data for stats until API integration
          followers: Math.floor(Math.random() * (500000 - 5000) + 5000),
          engagementRate: parseFloat((Math.random() * (8 - 1.5) + 1.5).toFixed(1)),
        } as CreatorMarketplaceProfile;
      });
      setCreators(creatorsData);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching creators:", error);
      toast({ title: "Error", description: "Could not fetch creator data.", variant: "destructive" });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);


  const filteredCreators = creators.filter(creator => {
    const matchesSearch = creator.name.toLowerCase().includes(searchTerm.toLowerCase()) || creator.niche.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = contentTypeFilter === 'all' || creator.contentType === contentTypeFilter;
    return matchesSearch && matchesFilter;
  });

  const contentTypes = ["all", ...Array.from(new Set(creators.map(c => c.contentType)))];

  return (
    <>
      <PageHeader
        title="Creator Marketplace"
        description="Discover and connect with talented creators for your next campaign."
      />

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search by name or niche..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by content type" />
          </SelectTrigger>
          <SelectContent>
            {contentTypes.map(type => (
              <SelectItem key={type} value={type} className="capitalize">
                {type === 'all' ? 'All Content Types' : type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {isLoading ? (
        <div className="flex items-center justify-center p-10">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : filteredCreators.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredCreators.map(creator => (
            <CreatorCard key={creator.id} creator={creator} />
          ))}
        </div>
      ) : (
        <div className="text-center py-10">
          <h3 className="text-lg font-semibold">No Creators Found</h3>
          <p className="text-muted-foreground mt-2">No creators match your current filters, or no creators have opted into the marketplace yet.</p>
        </div>
      )}
    </>
  );
}
