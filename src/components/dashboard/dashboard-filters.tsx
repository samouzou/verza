
"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, Filter, Briefcase } from "lucide-react";
import { useState, useEffect } from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";

export interface DashboardFilterState {
  brand: string;
  project: string;
  dateRange?: DateRange;
}

interface DashboardFiltersProps {
  availableBrands: string[];
  availableProjects: string[];
  onFiltersChange: (filters: DashboardFilterState) => void;
  initialFilters: DashboardFilterState;
}

export function DashboardFilters({ 
  availableBrands, 
  availableProjects, 
  onFiltersChange,
  initialFilters 
}: DashboardFiltersProps) {
  const [selectedBrand, setSelectedBrand] = useState<string>(initialFilters.brand);
  const [selectedProject, setSelectedProject] = useState<string>(initialFilters.project);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialFilters.dateRange);

  useEffect(() => {
    onFiltersChange({ brand: selectedBrand, project: selectedProject, dateRange });
  }, [selectedBrand, selectedProject, dateRange, onFiltersChange]);
  
  const handleClearFilters = () => {
    setSelectedBrand("all");
    setSelectedProject("all");
    setDateRange(undefined);
    // The useEffect will trigger onFiltersChange with cleared values
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
      <Filter className="h-5 w-5 text-muted-foreground" />
      <span className="text-sm font-medium text-muted-foreground mr-2">Filters:</span>
      
      <Select value={selectedBrand} onValueChange={setSelectedBrand}>
        <SelectTrigger className="w-full sm:w-[180px] bg-background">
          <SelectValue placeholder="All Brands" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Brands</SelectItem>
          {availableBrands.map(brand => (
            <SelectItem key={brand} value={brand}>{brand}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedProject} onValueChange={setSelectedProject}>
        <SelectTrigger className="w-full sm:w-[180px] bg-background">
          <Briefcase className="mr-2 h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Projects</SelectItem>
           {availableProjects.map(project => (
            <SelectItem key={project} value={project}>{project}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={"outline"}
            className="w-full sm:w-[240px] justify-start text-left font-normal bg-background"
          >
            <CalendarDays className="mr-2 h-4 w-4" />
            {dateRange?.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                </>
              ) : (
                format(dateRange.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={setDateRange}
            initialFocus
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
      
      <Button variant="ghost" onClick={handleClearFilters} className="text-muted-foreground hover:text-primary">
        Clear Filters
      </Button>
    </div>
  );
}
