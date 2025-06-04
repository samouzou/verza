
"use client";

import { useState, type FormEvent, type ChangeEvent, useEffect } from "react";
import { useAuth, type UserProfile } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea"; // Import Textarea
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";
import { auth, db, doc, updateDoc, storage } from "@/lib/firebase";
import { updateProfile as updateFirebaseUserProfile } from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface UpdateProfileFormProps {
  currentUser: UserProfile;
}

export function UpdateProfileForm({ currentUser }: UpdateProfileFormProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [address, setAddress] = useState(currentUser.address || ""); // Add address state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(currentUser.avatarUrl);
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const { refreshAuthUser } = useAuth();

  useEffect(() => {
    setDisplayName(currentUser.displayName || "");
    setAddress(currentUser.address || ""); // Update address from currentUser
    setImagePreview(currentUser.avatarUrl);
  }, [currentUser]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setSelectedFile(null);
      setImagePreview(currentUser.avatarUrl);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) {
      toast({ title: "Error", description: "No authenticated user found.", variant: "destructive" });
      return;
    }
    if (!displayName.trim() && !selectedFile && address.trim() === (currentUser.address || "")) {
      toast({ title: "No Changes", description: "Please make changes to save.", variant: "default" });
      return;
    }

    setIsUpdating(true);
    let newAvatarUrl: string | null = currentUser.avatarUrl;

    try {
      if (selectedFile) {
        const avatarStorageRef = storageRef(storage, `avatars/${currentUser.uid}/${selectedFile.name}`);
        const uploadResult = await uploadBytes(avatarStorageRef, selectedFile);
        newAvatarUrl = await getDownloadURL(uploadResult.ref);
      }

      const authUpdates: { displayName?: string; photoURL?: string | null } = {};
      const firestoreUpdates: { displayName?: string; avatarUrl?: string | null; address?: string } = {};
      let hasChanges = false;

      if (displayName.trim() && displayName.trim() !== currentUser.displayName) {
        authUpdates.displayName = displayName.trim();
        firestoreUpdates.displayName = displayName.trim();
        hasChanges = true;
      }
      if (newAvatarUrl && newAvatarUrl !== currentUser.avatarUrl) {
        authUpdates.photoURL = newAvatarUrl;
        firestoreUpdates.avatarUrl = newAvatarUrl;
        hasChanges = true;
      }
      if (address.trim() !== (currentUser.address || "")) {
        firestoreUpdates.address = address.trim();
        hasChanges = true;
      }
      
      if (!hasChanges) {
        toast({ title: "No Changes Detected", description: "Your profile information is already up to date.", variant: "default" });
        setIsUpdating(false);
        return;
      }

      if (Object.keys(authUpdates).length > 0) {
        await updateFirebaseUserProfile(auth.currentUser, authUpdates);
      }

      if (Object.keys(firestoreUpdates).length > 0) {
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, firestoreUpdates);
      }
      
      toast({ title: "Success", description: "Profile updated successfully." });
      await refreshAuthUser();
      setSelectedFile(null);

    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast({ title: "Error", description: error.message || "Failed to update profile.", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const userInitialForFallback = currentUser.displayName ? currentUser.displayName.charAt(0).toUpperCase() : (currentUser.email ? currentUser.email.charAt(0).toUpperCase() : "U");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="avatarFile">Profile Picture</Label>
        <div className="flex items-center gap-4">
          <Avatar className="h-20 w-20">
            {imagePreview ? (
              <AvatarImage src={imagePreview} alt={currentUser.displayName || "User avatar"} data-ai-hint="user avatar" />
            ) : (
              <AvatarFallback className="text-3xl">{userInitialForFallback}</AvatarFallback>
            )}
          </Avatar>
          <Input
            id="avatarFile"
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="max-w-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground">Recommended: Square image, less than 2MB.</p>
      </div>

      <div>
        <Label htmlFor="displayName">Display Name</Label>
        <Input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your Name"
          className="mt-1"
        />
      </div>

      <div>
        <Label htmlFor="address">Address (for Invoices)</Label>
        <Textarea
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, State, Zip Code, Country"
          className="mt-1"
          rows={3}
        />
        <p className="text-xs text-muted-foreground mt-1">This address will be used as the 'From' address on your invoices.</p>
      </div>

      <Button 
        type="submit" 
        disabled={isUpdating || (displayName === (currentUser.displayName || "") && !selectedFile && address === (currentUser.address || ""))}
      >
        {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save Changes
      </Button>
    </form>
  );
}
