
"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2 } from "lucide-react";
import { auth, db, doc, deleteDoc } from "@/lib/firebase";
import { deleteUser as deleteFirebaseAuthUser } from "firebase/auth";
import { useRouter } from "next/navigation";

export function DeleteAccountSection() {
  const { user, logout } = useAuth(); // Using logout from useAuth now
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const handleDeleteAccount = async () => {
    if (!user || !auth.currentUser) {
      toast({ title: "Error", description: "No authenticated user found.", variant: "destructive" });
      return;
    }

    setIsDeleting(true);
    try {
      // 1. Delete Firestore user document (optional, but good practice for cleanup)
      const userDocRef = doc(db, "users", user.uid);
      await deleteDoc(userDocRef);
      toast({ title: "Info", description: "User data removed from database." });

      // 2. Delete Firebase Auth user
      // IMPORTANT: This is a sensitive operation. It might require recent sign-in.
      // If it fails with 'auth/requires-recent-login', user needs to re-authenticate.
      await deleteFirebaseAuthUser(auth.currentUser);
      
      toast({ title: "Account Deleted", description: "Your account has been permanently deleted." });
      
      // `onAuthStateChanged` in `useAuth` will handle setting user to null.
      // Forcing a logout and redirect here ensures immediate effect.
      await logout(); // Clear local auth state
      router.push("/login"); // Redirect to login

    } catch (error: any) {
      console.error("Error deleting account:", error);
      if (error.code === "auth/requires-recent-login") {
        toast({
          title: "Re-authentication Required",
          description: "Please log out and log back in again before deleting your account.",
          variant: "destructive",
          duration: 7000,
        });
      } else {
        toast({ title: "Deletion Failed", description: error.message || "Could not delete account.", variant: "destructive" });
      }
    } finally {
      setIsDeleting(false);
      setIsDialogOpen(false);
    }
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">Delete Account</CardTitle>
        <CardDescription>
          Permanently delete your Verza account and all associated data. This action cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isDeleting}>
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete My Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete your
                account, your profile information, and all your contracts from Verza.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Yes, delete my account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
         <p className="mt-2 text-xs text-muted-foreground">
           Note: Deleting your account here will remove your user record and profile.
           Associated contract data will also be removed.
           Consider implications for any active subscriptions if applicable.
         </p>
      </CardContent>
    </Card>
  );
}
