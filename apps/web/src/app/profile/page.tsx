
"use client";

import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";
import { UpdateProfileForm } from "@/components/profile/update-profile-form";
import { DeleteAccountSection } from "@/components/profile/delete-account-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

export default function ProfilePage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Profile" description="Manage your account details." />
        <Card>
          <CardHeader>
            <CardTitle>Your Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <Skeleton className="h-10 w-1/3" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delete Account</CardTitle>
            <CardDescription>Permanently delete your account and all associated data.</CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full pt-10">
        <AlertCircle className="w-12 h-12 text-primary mb-4" />
        <p className="text-xl text-muted-foreground">Please log in to view your profile.</p>
      </div>
    );
  }

  const userInitial = user.displayName ? user.displayName.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : "U");

  return (
    <>
      <PageHeader title="Profile" description="Manage your account details and preferences." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.displayName || "User avatar"} data-ai-hint="user avatar" />}
                <AvatarFallback className="text-2xl">{userInitial}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-xl font-semibold">{user.displayName || "User"}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <UpdateProfileForm currentUser={user} />
          </CardContent>
        </Card>

        <DeleteAccountSection />
      </div>
    </>
  );
}
