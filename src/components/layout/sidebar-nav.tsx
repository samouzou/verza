
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import {
  LayoutDashboard,
  FileText,
  Link2,
  Wallet,
  Settings,
  LogOut,
  UserCircle,
  ChevronDown,
  Sparkles,
  CheckCircle,
  XCircle,
  AlertTriangle as AlertTriangleIcon,
  ReceiptText,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  FileStack,
  Building,
  BarChart3,
  Video,
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { SetupGuide } from "./setup-guide"; // Import the new component

const navItems = [
  { id: 'nav-item-dashboard', href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: 'nav-item-contracts', href: "/contracts", label: "Contracts", icon: FileText },
  { id: 'nav-item-receipts', href: "/receipts", label: "Receipts", icon: ReceiptText },
  { id: 'nav-item-banking', href: "/banking", label: "Banking & Taxes", icon: Landmark },
  { id: 'nav-item-tax-forms', href: "/tax-forms", label: "Tax Forms", icon: FileStack },
  { id: 'nav-item-wallet', href: "/wallet", label: "Creator Wallet", icon: Wallet },
  { id: 'nav-item-agency', href: "/agency", label: "Agency", icon: Building },
  { id: 'nav-item-integrations', href: "/integrations", label: "Integrations", icon: Link2 },
];


export function SidebarNav() {
  const pathname = usePathname();
  const { user, logout, isLoading: authLoading } = useAuth();
  const { open, setOpen, setOpenMobile, isMobile } = useSidebar();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  if (authLoading) {
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-4">
           <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
             <svg width="180" height="50" viewBox="0 0 200 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-data-[collapsible=icon]:hidden">
                <text x="0" y="35" fontFamily="GeistSans, sans-serif" fontSize="36" fontWeight="600" fill="hsl(var(--primary))">Verza</text>
             </svg>
             <svg width="40" height="40" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="hidden group-data-[collapsible=icon]:block">
                <text x="5" y="35" fontFamily="GeistSans, sans-serif" fontSize="36" fontWeight="600" fill="hsl(var(--primary))">V</text>
             </svg>
          </div>
        </SidebarHeader>
        <SidebarContent>
        </SidebarContent>
        <SidebarFooter className="p-2">
          <div className="h-14 w-full rounded-md bg-muted animate-pulse" />
        </SidebarFooter>
      </Sidebar>
    );
  }

  const activeUser = user;
  const userInitial = activeUser?.displayName ? activeUser.displayName.charAt(0).toUpperCase() : (activeUser?.email ? activeUser.email.charAt(0).toUpperCase() : 'U');

  const getSubscriptionBadge = () => {
    if (!activeUser || !activeUser.subscriptionStatus) {
      return null;
    }
    
    if (activeUser.subscriptionPlanId === 'individual_free') {
       return <Badge variant="secondary" className="ml-2 text-xs px-1.5 py-0.5 group-data-[collapsible=icon]:hidden">Free</Badge>;
    }
    
    const planName = activeUser.subscriptionPlanId?.includes('agency_pro') ? 'Agency Pro' : 
                     activeUser.subscriptionPlanId?.includes('agency_start') ? 'Agency Start' : 'Pro';

    switch (activeUser.subscriptionStatus) {
      case 'active':
        return <Badge variant="default" className="ml-2 text-xs px-1.5 py-0.5 bg-green-500 hover:bg-green-600 text-white group-data-[collapsible=icon]:hidden">{planName}</Badge>;
      case 'trialing':
        return <Badge variant="secondary" className="ml-2 text-xs px-1.5 py-0.5 bg-blue-500 hover:bg-blue-600 text-white group-data-[collapsible=icon]:hidden">Trial</Badge>;
      case 'past_due':
        return <Badge variant="destructive" className="ml-2 text-xs px-1.5 py-0.5 group-data-[collapsible=icon]:hidden">Issue</Badge>;
      case 'canceled':
         return <Badge variant="outline" className="ml-2 text-xs px-1.5 py-0.5 group-data-[collapsible=icon]:hidden">Canceled</Badge>;
      default:
        return null;
    }
  };
  
  const subscriptionBadge = getSubscriptionBadge();


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:mx-auto">
            <Image src="/verza-icon.svg" alt="Verza Icon" width={24} height={18} className="w-6" />
            <span className="font-semibold text-lg group-data-[collapsible=icon]:hidden">Verza</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <Link href="/scene-spawner" legacyBehavior passHref>
                <SidebarMenuButton
                  onClick={() => isMobile && setOpenMobile(false)}
                  className="group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center"
                  isActive={pathname === "/scene-spawner"}
                  tooltip={{ children: "Scene Spawner", className: "group-data-[collapsible=icon]:block hidden"}}
                >
                  <Video className="h-5 w-5" />
                  <span className="group-data-[collapsible=icon]:hidden">Scene Spawner</span>
                </SidebarMenuButton>
              </Link>
          </SidebarMenuItem>
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center">
                <span className="group-data-[collapsible=icon]:hidden">Verza Suite</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.label} id={item.id}>
                  <Link href={item.href} legacyBehavior passHref>
                    <SidebarMenuButton
                      onClick={() => isMobile && setOpenMobile(false)}
                      className="group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center"
                      isActive={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))}
                      tooltip={{ children: item.label, className: "group-data-[collapsible=icon]:block hidden"}}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-2 flex flex-col gap-2">
         <SetupGuide />
         <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <ThemeToggle />
         </div>
         {activeUser ? (
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start p-2 h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-auto">
                <Avatar className="h-9 w-9 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
                  {activeUser.avatarUrl && <AvatarImage src={activeUser.avatarUrl} alt={activeUser.displayName || 'User Avatar'} data-ai-hint="user avatar" />}
                  <AvatarFallback>{userInitial}</AvatarFallback>
                </Avatar>
                <div className="ml-3 text-left group-data-[collapsible=icon]:hidden">
                  <div className="flex items-center">
                     <p className="text-sm font-medium truncate max-w-[100px]">{activeUser.displayName || 'User'}</p>
                     {subscriptionBadge}
                  </div>
                  <p className="text-xs text-muted-foreground truncate max-w-[120px]">{activeUser.email || 'No email'}</p>
                </div>
                <ChevronDown className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56 mb-2 ml-2">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <UserCircle className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
         ) : (
          <Button variant="ghost" className="w-full justify-start p-2 h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-auto" onClick={() => router.push('/login')}>
             <UserCircle className="h-8 w-8" />
             <span className="ml-3 group-data-[collapsible=icon]:hidden">Login</span>
          </Button>
         )}
         <SidebarMenuButton
            onClick={() => setOpen(!open)}
            className="hidden md:flex justify-start text-muted-foreground"
            variant="ghost"
            tooltip={{
              children: open ? "Collapse Sidebar" : "Expand Sidebar",
              className: "group-data-[collapsible=icon]:block hidden",
            }}
          >
            {open ? (
              <PanelLeftClose className="h-5 w-5" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" />
            )}
            <span className="group-data-[collapsible=icon]:hidden">
              Collapse Sidebar
            </span>
          </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
