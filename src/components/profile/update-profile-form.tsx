
"use client";

import { useState, type FormEvent, type ChangeEvent, useEffect } from "react";
import { useAuth, type UserProfile } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea"; // Import Textarea
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, UploadCloud, Briefcase, Landmark } from "lucide-react";
import { auth, db, doc, updateDoc, storage } from "@/lib/firebase";
import { updateProfile as updateFirebaseUserProfile } from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CreatorMarketplaceProfile, TaxClassification } from "@/types";

interface UpdateProfileFormProps {
  currentUser: UserProfile;
}

const contentTypes: CreatorMarketplaceProfile['contentType'][] = ['Tech', 'Fashion', 'Comedy', 'Gaming', 'Lifestyle', 'Food'];

const taxClassifications: { value: TaxClassification; label: string }[] = [
  { value: 'individual', label: 'Individual/Sole Proprietor' },
  { value: 'c_corp', label: 'C Corporation' },
  { value: 's_corp', label: 'S Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'trust_estate', label: 'Trust/Estate' },
  { value: 'llc', label: 'Limited Liability Company' },
];

export function UpdateProfileForm({ currentUser }: UpdateProfileFormProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [legalName, setLegalName] = useState(currentUser.legalName || "");
  const [address, setAddress] = useState(currentUser.address || ""); 
  const [tin, setTin] = useState(currentUser.tin || "");
  const [taxClassification, setTaxClassification] = useState<TaxClassification | null>(currentUser.taxClassification || null);
  
  // Marketplace fields
  const [showInMarketplace, setShowInMarketplace] = useState(currentUser.showInMarketplace || false);
  const [niche, setNiche] = useState(currentUser.niche || "");
  const [contentType, setContentType] = useState(currentUser.contentType);


  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(currentUser.avatarUrl);
  
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(currentUser.companyLogoUrl || null);

  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const { refreshAuthUser } = useAuth();

  useEffect(() => {
    setDisplayName(currentUser.displayName || "");
    setLegalName(currentUser.legalName || "");
    setAddress(currentUser.address || "");
    setTin(currentUser.tin || "");
    setTaxClassification(currentUser.taxClassification || null);
    setAvatarPreview(currentUser.avatarUrl);
    setLogoPreview(currentUser.companyLogoUrl || null);
    setShowInMarketplace(currentUser.showInMarketplace || false);
    setNiche(currentUser.niche || "");
    setContentType(currentUser.contentType);
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
                             legalName.trim() !== (currentUser.legalName || "") ||
                             address.trim() !== (currentUser.address || "") ||
                             tin.trim() !== (currentUser.tin || "") ||
                             taxClassification !== (currentUser.taxClassification || null) ||
                             showInMarketplace !== (currentUser.showInMarketplace || false) ||
                             niche.trim() !== (currentUser.niche || "") ||
                             contentType !== currentUser.contentType ||
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
      if (legalName.trim() !== (currentUser.legalName || "")) {
        firestoreUpdates.legalName = legalName.trim();
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
      if (taxClassification !== (currentUser.taxClassification || null)) {
        firestoreUpdates.taxClassification = taxClassification;
      }
      if (showInMarketplace !== (currentUser.showInMarketplace || false)) {
        firestoreUpdates.showInMarketplace = showInMarketplace;
      }
      if (niche.trim() !== (currentUser.niche || "")) {
        firestoreUpdates.niche = niche.trim();
      }
      if (contentType !== currentUser.contentType) {
        firestoreUpdates.contentType = contentType;
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

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-6">
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
            <Label htmlFor="displayName">Public Display Name</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              className="mt-1"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> Tax & W-9 Information</CardTitle>
          <CardDescription>Capture legal information for tax reporting and end-of-year summaries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label htmlFor="legalName">Legal Name (for W-9)</Label>
              <Input
                id="legalName"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Individual or Business Legal Name"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="tin">Taxpayer ID (SSN/EIN)</Label>
              <Input
                id="tin"
                type="password"
                value={tin}
                onChange={(e) => setTin(e.target.value)}
                placeholder="XXX-XX-XXXX"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="taxClassification">Tax Classification</Label>
              <Select value={taxClassification || ""} onValueChange={(val) => setTaxClassification(val as TaxClassification)}>
                <SelectTrigger id="taxClassification" className="mt-1">
                  <SelectValue placeholder="Select classification..." />
                </SelectTrigger>
                <SelectContent>
                  {taxClassifications.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="address">Legal Address (for Invoices & Tax Forms)</Label>
            <Textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, State, Zip Code, Country"
              className="mt-1"
              rows={3}
            />
            <p className="text-xs text-muted-foreground mt-1">This address will be used on your generated invoices and tax summaries.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-primary" /> Marketplace Profile</CardTitle>
          <CardDescription>This information will be visible to brands in the Creator Marketplace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="showInMarketplace" className="text-base">Show my profile in the Marketplace</Label>
              <p className="text-sm text-muted-foreground">Allow brands to discover and contact you.</p>
            </div>
            <Switch
              id="showInMarketplace"
              checked={showInMarketplace}
              onCheckedChange={setShowInMarketplace}
            />
          </div>

          {showInMarketplace && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="niche">Your Niche</Label>
                <Input
                  id="niche"
                  value={niche}
                  onChange={e => setNiche(e.target.value)}
                  placeholder="e.g., AI & Future Tech"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="contentType">Primary Content Type</Label>
                <Select value={contentType} onValueChange={(value) => setContentType(value as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a content type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contentTypes.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button type="submit" disabled={isUpdating}>
        {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save Changes
      </Button>
    </form>
  );
}
