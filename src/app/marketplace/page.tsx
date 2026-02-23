"use client";

import { PageHeader } from "@/components/page-header";
import { CreatorCard } from "@/components/marketplace/creator-card";
import { mockCreators } from "@/data/mock-creator-data";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function MarketplacePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");

  const filteredCreators = mockCreators.filter(creator => {
    const matchesSearch = creator.name.toLowerCase().includes(searchTerm.toLowerCase()) || creator.niche.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = contentTypeFilter === 'all' || creator.contentType === contentTypeFilter;
    return matchesSearch && matchesFilter;
  });

  const contentTypes = ["all", ...Array.from(new Set(mockCreators.map(c => c.contentType)))];

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

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {filteredCreators.map(creator => (
          <CreatorCard key={creator.id} creator={creator} />
        ))}
      </div>
    </>
  );
}
