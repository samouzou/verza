"use client";

import React, { useState, useMemo } from 'react';
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarInset,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Home,
  BotMessageSquare,
  Lightbulb,
  ShieldCheck,
  View,
  Settings,
  LayoutTemplate,
  AppWindow,
  Waypoints,
  Share,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Header } from './Header';

import { ProjectImportSection } from './sections/ProjectImportSection';
import { AiCodeGenerationSection } from './sections/AiCodeGenerationSection';
import { AiUiSuggestionsSection } from './sections/AiUiSuggestionsSection';
import { AiCompatibilityCheckSection } from './sections/AiCompatibilityCheckSection';
import { InteractivePreviewSection } from './sections/InteractivePreviewSection';
import { DataFlowDiagramSection } from './sections/DataFlowDiagramSection';
import { UiRelationshipSection } from './sections/UiRelationshipSection';
import { ThemeProvider } from "next-themes"


type ActiveView =
  | 'overview'
  | 'ai-code-gen'
  | 'ai-ui-suggestions'
  | 'ai-compatibility'
  | 'view-component-preview'
  | 'view-data-flow'
  | 'view-ui-relationships';

const viewComponents: Record<ActiveView, React.FC> = {
  'overview': ProjectImportSection,
  'ai-code-gen': AiCodeGenerationSection,
  'ai-ui-suggestions': AiUiSuggestionsSection,
  'ai-compatibility': AiCompatibilityCheckSection,
  'view-component-preview': InteractivePreviewSection,
  'view-data-flow': DataFlowDiagramSection,
  'view-ui-relationships': UiRelationshipSection,
};

const viewTitles: Record<ActiveView, string> = {
  'overview': 'Project Overview',
  'ai-code-gen': 'AI Code Generation',
  'ai-ui-suggestions': 'AI UI Suggestions',
  'ai-compatibility': 'AI Compatibility Check',
  'view-component-preview': 'Interactive Component Preview',
  'view-data-flow': 'Data Flow Diagram',
  'view-ui-relationships': 'UI Element Relationships',
};

export function DashboardLayout() {
  const [activeView, setActiveView] = useState<ActiveView>('overview');
  const [isSpecializedViewsOpen, setIsSpecializedViewsOpen] = useState(true);
  const [isAiToolsOpen, setIsAiToolsOpen] = useState(true);

  const ActiveComponent = useMemo(() => viewComponents[activeView], [activeView]);
  const currentTitle = useMemo(() => viewTitles[activeView], [activeView]);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon" className="border-r">
          <SidebarHeader className="p-2 flex items-center gap-2 justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="text-primary rounded-full aspect-square h-9 w-9">
                <LayoutTemplate className="h-5 w-5" />
              </Button>
              <span className="font-semibold font-headline text-lg">Verza Canvas</span>
            </div>
            <SidebarTrigger className="md:hidden" />
          </SidebarHeader>
          <SidebarContent className="p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setActiveView('overview')}
                  isActive={activeView === 'overview'}
                  tooltip={{ children: "Project Overview" }}
                >
                  <Home />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <SidebarSeparator className="my-3" />
            
            <SidebarGroup>
              <SidebarGroupLabel
                onClick={() => setIsAiToolsOpen(!isAiToolsOpen)}
                className="cursor-pointer flex justify-between items-center"
              >
                AI Tools
                {isAiToolsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </SidebarGroupLabel>
              {isAiToolsOpen && (
                <SidebarMenu className="pl-2 border-l border-sidebar-border ml-2">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setActiveView('ai-code-gen')}
                      isActive={activeView === 'ai-code-gen'}
                      tooltip={{ children: "AI Code Generation" }}
                    >
                      <BotMessageSquare />
                      <span>Code Generation</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setActiveView('ai-ui-suggestions')}
                      isActive={activeView === 'ai-ui-suggestions'}
                      tooltip={{ children: "AI UI Suggestions" }}
                    >
                      <Lightbulb />
                      <span>UI Suggestions</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setActiveView('ai-compatibility')}
                      isActive={activeView === 'ai-compatibility'}
                      tooltip={{ children: "AI Compatibility Check" }}
                    >
                      <ShieldCheck />
                      <span>Compatibility Check</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              )}
            </SidebarGroup>

            <SidebarSeparator className="my-3" />

            <SidebarGroup>
              <SidebarGroupLabel
                onClick={() => setIsSpecializedViewsOpen(!isSpecializedViewsOpen)}
                className="cursor-pointer flex justify-between items-center"
              >
                Specialized Views
                {isSpecializedViewsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </SidebarGroupLabel>
              {isSpecializedViewsOpen && (
                <SidebarMenu className="pl-2 border-l border-sidebar-border ml-2">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setActiveView('view-component-preview')}
                      isActive={activeView === 'view-component-preview'}
                       tooltip={{ children: "Component Preview" }}
                    >
                      <AppWindow />
                      <span>Component Preview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setActiveView('view-data-flow')}
                      isActive={activeView === 'view-data-flow'}
                      tooltip={{ children: "Data Flow Diagram" }}
                    >
                      <Waypoints />
                      <span>Data Flow Diagram</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setActiveView('view-ui-relationships')}
                      isActive={activeView === 'view-ui-relationships'}
                      tooltip={{ children: "UI Relationships" }}
                    >
                      <Share />
                      <span>UI Relationships</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              )}
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip={{children: "Settings"}}>
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className="group/menu-item" tooltip={{children: "User Profile"}}>
                  <Avatar className="h-7 w-7">
                    <AvatarImage src="https://placehold.co/32x32.png?text=VC" alt="Verza Canvas User" data-ai-hint="user avatar"/>
                    <AvatarFallback>VC</AvatarFallback>
                  </Avatar>
                  <span className="ml-1">User Profile</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="flex flex-col min-h-screen">
          <Header title={currentTitle} />
          <main className="flex-1 p-4 md:p-6 overflow-y-auto">
            <ActiveComponent />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}
