
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  AlertTriangle as AlertTriangleIcon // Renamed to avoid conflict
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
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

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contracts", label: "Contracts", icon: FileText },
  { href: "/integrations", label: "Integrations", icon: Link2 },
  { href: "/wallet", label: "Creator Wallet", icon: Wallet },
  // { href: "/settings", label: "Settings", icon: Settings }, // Removed from main nav items
];

export function SidebarNav() {
  const pathname = usePathname();
  const { user, logout, isLoading } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  if (isLoading) {
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-4">
           <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
             <svg width="180" height="50" viewBox="0 0 200 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-data-[collapsible=icon]:hidden">
                <text x="0" y="35" fontFamily="Space Grotesk, sans-serif" fontSize="36" fontWeight="600" fill="hsl(var(--primary))">Verza</text>
             </svg>
             <svg width="40" height="40" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="hidden group-data-[collapsible=icon]:block">
                <text x="5" y="35" fontFamily="Space Grotesk, sans-serif" fontSize="36" fontWeight="600" fill="hsl(var(--primary))">V</text>
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
    if (!activeUser || !activeUser.subscriptionStatus || activeUser.subscriptionStatus === 'none') {
      return null; 
    }
    switch (activeUser.subscriptionStatus) {
      case 'active':
        return <Badge variant="default" className="ml-2 text-xs px-1.5 py-0.5 bg-green-500 hover:bg-green-600 text-white group-data-[collapsible=icon]:hidden">Pro</Badge>;
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
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
           <svg width="180" height="50" viewBox="0 0 200 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-data-[collapsible=icon]:hidden">
             <text x="0" y="35" fontFamily="Space Grotesk, sans-serif" fontSize="36" fontWeight="600" fill="hsl(var(--primary))">Verza</text>
           </svg>
            <svg width="40" height="40" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="hidden group-data-[collapsible=icon]:block">
             <text x="5" y="35" fontFamily="Space Grotesk, sans-serif" fontSize="36" fontWeight="600" fill="hsl(var(--primary))">V</text>
           </svg>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <Link href={item.href} legacyBehavior passHref>
                <SidebarMenuButton
                  className={cn(
                    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  isActive={pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))}
                  tooltip={{ children: item.label, className: "group-data-[collapsible=icon]:block hidden"}}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-2">
         <div className="mb-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
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
      </SidebarFooter>
    </Sidebar>
  );
}
