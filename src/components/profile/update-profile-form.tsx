
"use client";

import { useState, type FormEvent, type ChangeEvent, useEffect } from "react";
import { useAuth, type UserProfile } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea"; // Import Textarea
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, UploadCloud } from "lucide-react";
import { auth, db, doc, updateDoc, storage } from "@/lib/firebase";
import { updateProfile as updateFirebaseUserProfile } from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Image from "next/image";

interface UpdateProfileFormProps {
  currentUser: UserProfile;
}

export function UpdateProfileForm({ currentUser }: UpdateProfileFormProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [address, setAddress] = useState(currentUser.address || ""); 
  const [tin, setTin] = useState(currentUser.tin || ""); // Add TIN state
  
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(currentUser.avatarUrl);
  
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(currentUser.companyLogoUrl || null);

  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const { refreshAuthUser } = useAuth();

  useEffect(() => {
    setDisplayName(currentUser.displayName || "");
    setAddress(currentUser.address || "");
    setTin(currentUser.tin || "");
    setAvatarPreview(currentUser.avatarUrl);
    setLogoPreview(currentUser.companyLogoUrl || null);
  }, [currentUser]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, type: 'avatar' | 'logo') => {
    const file = e.target.files?.[0];
    if (file) {
      if (type === 'avatar') {
        setAvatarFile(file);
        const reader = new FileReader();
        reader.onloadend = () => setAvatarPreview(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        setLogoFile(file);
        const reader = new FileReader();
        reader.onloadend = () => setLogoPreview(reader.result as string);
        reader.readAsDataURL(file);
      }
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) {
      toast({ title: "Error", description: "No authenticated user found.", variant: "destructive" });
      return;
    }
    
    const hasProfileChanged = displayName.trim() !== (currentUser.displayName || "") ||
                             address.trim() !== (currentUser.address || "") ||
                             tin.trim() !== (currentUser.tin || "") ||
                             !!avatarFile || !!logoFile;

    if (!hasProfileChanged) {
      toast({ title: "No Changes", description: "Please make changes to save.", variant: "default" });
      return;
    }

    setIsUpdating(true);
    let newAvatarUrl: string | null = currentUser.avatarUrl;
    let newLogoUrl: string | null = currentUser.companyLogoUrl || null;

    try {
      if (avatarFile) {
        const avatarStorageRef = storageRef(storage, `avatars/${currentUser.uid}/${avatarFile.name}`);
        const uploadResult = await uploadBytes(avatarStorageRef, avatarFile);
        newAvatarUrl = await getDownloadURL(uploadResult.ref);
      }

      if (logoFile) {
        const logoStorageRef = storageRef(storage, `logos/${currentUser.uid}/${logoFile.name}`);
        const uploadResult = await uploadBytes(logoStorageRef, logoFile);
        newLogoUrl = await getDownloadURL(uploadResult.ref);
      }

      const authUpdates: { displayName?: string; photoURL?: string | null } = {};
      const firestoreUpdates: { [key: string]: any } = {};

      if (displayName.trim() !== currentUser.displayName) {
        authUpdates.displayName = displayName.trim();
        firestoreUpdates.displayName = displayName.trim();
      }
      if (newAvatarUrl && newAvatarUrl !== currentUser.avatarUrl) {
        authUpdates.photoURL = newAvatarUrl;
        firestoreUpdates.avatarUrl = newAvatarUrl;
      }
      if (newLogoUrl && newLogoUrl !== currentUser.companyLogoUrl) {
        firestoreUpdates.companyLogoUrl = newLogoUrl;
      }
      if (address.trim() !== (currentUser.address || "")) {
        firestoreUpdates.address = address.trim();
      }
      if (tin.trim() !== (currentUser.tin || "")) {
        firestoreUpdates.tin = tin.trim();
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
      setAvatarFile(null);
      setLogoFile(null);

    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast({ title: "Error", description: error.message || "Failed to update profile.", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const userInitialForFallback = currentUser.displayName ? currentUser.displayName.charAt(0).toUpperCase() : (currentUser.email ? currentUser.email.charAt(0).toUpperCase() : "U");
  
  const hasChanges = displayName.trim() !== (currentUser.displayName || "") ||
                     address.trim() !== (currentUser.address || "") ||
                     tin.trim() !== (currentUser.tin || "") ||
                     !!avatarFile || !!logoFile;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
            <Label htmlFor="avatarFile">Profile Picture</Label>
            <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
                {avatarPreview ? (
                <AvatarImage src={avatarPreview} alt={currentUser.displayName || "User avatar"} data-ai-hint="user avatar" />
                ) : (
                <AvatarFallback className="text-3xl">{userInitialForFallback}</AvatarFallback>
                )}
            </Avatar>
            <Input
                id="avatarFile"
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e, 'avatar')}
                className="max-w-xs"
            />
            </div>
            <p className="text-xs text-muted-foreground">Recommended: Square image, less than 2MB.</p>
        </div>

        <div className="space-y-2">
            <Label htmlFor="logoFile">Company Logo (for Invoices)</Label>
            <div className="flex items-center gap-4">
                <div className="h-20 w-20 flex items-center justify-center border rounded-md bg-muted/50">
                    {logoPreview ? (
                        <Image src={logoPreview} alt="Company Logo" width={80} height={80} className="object-contain h-full w-full" data-ai-hint="company logo" />
                    ) : (
                        <UploadCloud className="h-8 w-8 text-muted-foreground" />
                    )}
                </div>
                 <Input
                    id="logoFile"
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'logo')}
                    className="max-w-xs"
                />
            </div>
            <p className="text-xs text-muted-foreground">Recommended: Transparent background, less than 2MB.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
          <Label htmlFor="tin">Taxpayer ID (SSN/EIN)</Label>
          <Input
            id="tin"
            type="text"
            value={tin}
            onChange={(e) => setTin(e.target.value)}
            placeholder="XXX-XX-XXXX"
            className="mt-1"
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="address">Address (for Invoices & Tax Forms)</Label>
        <Textarea
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, State, Zip Code, Country"
          className="mt-1"
          rows={3}
        />
        <p className="text-xs text-muted-foreground mt-1">This address will be used on your invoices and tax forms.</p>
      </div>

      <Button 
        type="submit" 
        disabled={isUpdating || !hasChanges}
      >
        {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save Changes
      </Button>
    </form>
  );
}
