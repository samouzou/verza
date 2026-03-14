
"use client";

import type { ReactNode } from 'react';
import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { GoogleAuthProvider as FirebaseAuthGoogleAuthProvider } from 'firebase/auth'; // Renamed to avoid conflict
import {
  auth,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword as firebaseCreateUserWithEmailAndPassword,
  signInWithEmailAndPassword as firebaseSignInWithEmailAndPassword,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  sendEmailVerification,
  updateProfile as firebaseUpdateProfile,
  type User as FirebaseUser,
  db,
  doc,
  setDoc,
  getDoc,
  Timestamp,
  onSnapshot, // Import onSnapshot for real-time listening
} from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import type { CreatorMarketplaceProfile, SubscriptionPlanId, SubscriptionStatus, TaxClassification } from '@/types';


export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  legalName?: string | null;
  avatarUrl: string | null;
  companyLogoUrl?: string | null;
  emailVerified: boolean;
  address?: string | null; 
  tin?: string | null;
  taxClassification?: TaxClassification | null;
  createdAt?: Timestamp;
  role: 'individual_creator' | 'agency_owner' | 'agency_admin' | 'agency_member';
  isAgencyOwner?: boolean;
  agencyMemberships?: Array<{ agencyId: string; agencyName: string; role: 'owner' | 'admin' | 'member' | 'talent', status: 'pending' | 'active' }>;
  primaryAgencyId?: string | null;

  // Subscription Fields
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionPlanId?: SubscriptionPlanId | null;
  talentLimit?: number;
  subscriptionInterval?: 'month' | 'year' | null;
  trialEndsAt?: Timestamp | null;
  subscriptionEndsAt?: Timestamp | null;
  trialExtensionUsed?: boolean;

  // Stripe Connected Account Fields
  stripeAccountId?: string | null;
  stripeAccountStatus?: 'none' | 'onboarding_incomplete' | 'pending_verification' | 'active' | 'restricted' | 'restricted_soon';
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  
  // Onboarding fields
  hasCreatedContract?: boolean;
  hasCompletedOnboarding?: boolean;
  emailSequence?: {
    step: number;
    nextEmailAt: Timestamp;
  };
  credits?: number;

  // Media Kit / Insights Fields
  missionStatement?: string | null;
  brandWishlist?: string[];
  followers?: number;
  engagementRate?: number;
  instagramConnected?: boolean;
  instagramFollowers?: number;
  instagramEngagement?: number;
  tiktokConnected?: boolean;
  tiktokFollowers?: number;
  tiktokEngagement?: number;
  youtubeConnected?: boolean;
  youtubeFollowers?: number;
  youtubeEngagement?: number;
  socialContent?: {
    instagram?: string;
    youtube?: string;
    tiktok?: string;
  };
  averageVerzaScore?: number;

  // Marketplace fields
  showInMarketplace?: boolean;
  niche?: string;
  contentType?: CreatorMarketplaceProfile['contentType'] | null;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: UserProfile | null;
  isAgency: boolean; // Helper to determine if user is in an agency flow
  isCreator: boolean; // Helper to determine if user is in a creator flow
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  loginWithEmailAndPassword: (email: string, password: string) => Promise<string | null>;
  signupWithEmailAndPassword: (email: string, password: string) => Promise<string | null>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<string | null>;
  isLoading: boolean;
  getUserIdToken: () => Promise<string | null>;
  refreshAuthUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const NEW_USER_BONUS = 50;

const createUserDocument = async (firebaseUser: FirebaseUser) => {
  if (!firebaseUser) return;
  const userDocRef = doc(db, 'users', firebaseUser.uid);
  const userDocSnap = await getDoc(userDocRef);

  const updates: Partial<UserProfile> = {};
  let needsUpdate = false;

  if (!userDocSnap.exists()) {
    const { uid, email, displayName, photoURL, emailVerified } = firebaseUser;
    const createdAt = Timestamp.now();
    const trialEndsAtTimestamp = new Timestamp(createdAt.seconds + 7 * 24 * 60 * 60, createdAt.nanoseconds);
    const twoDaysFromNow = new Timestamp(createdAt.seconds + 2 * 24 * 60 * 60, createdAt.nanoseconds);

    updates.uid = uid;
    updates.email = email;
    updates.displayName = displayName || email?.split('@')[0] || 'User';
    updates.legalName = null;
    updates.avatarUrl = photoURL || null;
    updates.companyLogoUrl = null;
    updates.emailVerified = emailVerified;
    updates.address = null; 
    updates.tin = null;
    updates.taxClassification = null;
    updates.createdAt = createdAt;
    updates.role = 'individual_creator';
    updates.isAgencyOwner = false;
    updates.agencyMemberships = [];

    updates.stripeCustomerId = null;
    updates.stripeSubscriptionId = null;
    updates.subscriptionStatus = 'trialing';
    updates.subscriptionPlanId = 'individual_monthly';
    updates.subscriptionInterval = null;
    updates.trialEndsAt = trialEndsAtTimestamp;
    updates.subscriptionEndsAt = null;
    updates.trialExtensionUsed = false;
    updates.talentLimit = 0;

    updates.stripeAccountId = null;
    updates.stripeAccountStatus = 'none';
    updates.stripeChargesEnabled = false;
    updates.stripePayoutsEnabled = false;
    
    updates.hasCompletedOnboarding = false;

    updates.emailSequence = {
      step: 1,
      nextEmailAt: twoDaysFromNow,
    };
    updates.credits = NEW_USER_BONUS;

    updates.showInMarketplace = false;
    updates.niche = '';
    updates.contentType = null;

    updates.instagramConnected = false;
    updates.instagramFollowers = 0;
    updates.instagramEngagement = 0;
    updates.youtubeConnected = false;
    updates.youtubeFollowers = 0;
    updates.youtubeEngagement = 0;
    updates.tiktokConnected = false;
    updates.tiktokFollowers = 0;
    updates.tiktokEngagement = 0;
    updates.averageVerzaScore = 0;
    updates.socialContent = {
      instagram: '',
      youtube: '',
      tiktok: '',
    };

    needsUpdate = true;

    try {
      await setDoc(userDocRef, updates);
    } catch (error) {
      console.error("Error creating user document in Firestore:", error);
    }
  } else {
    const existingData = userDocSnap.data() as UserProfile;
    const twoDaysFromNow = new Timestamp(Timestamp.now().seconds + 2 * 24 * 60 * 60, Timestamp.now().nanoseconds);

    if (firebaseUser.photoURL && existingData.avatarUrl !== firebaseUser.photoURL) {
      updates.avatarUrl = firebaseUser.photoURL;
      needsUpdate = true;
    }
    if (firebaseUser.displayName && existingData.displayName !== firebaseUser.displayName) {
      updates.displayName = firebaseUser.displayName;
      needsUpdate = true;
    }
    if (existingData.emailVerified !== firebaseUser.emailVerified) {
      updates.emailVerified = firebaseUser.emailVerified;
      needsUpdate = true;
    }
     if (existingData.emailSequence === undefined) {
      updates.emailSequence = {
        step: 1,
        nextEmailAt: twoDaysFromNow,
      };
      needsUpdate = true;
    }
    if (existingData.address === undefined) { 
      updates.address = null;
      needsUpdate = true;
    }
     if (existingData.tin === undefined) { 
      updates.tin = null;
      needsUpdate = true;
    }
    if (existingData.legalName === undefined) {
      updates.legalName = null;
      needsUpdate = true;
    }
    if (existingData.taxClassification === undefined) {
      updates.taxClassification = null;
      needsUpdate = true;
    }
    if (existingData.companyLogoUrl === undefined) {
      updates.companyLogoUrl = null;
      needsUpdate = true;
    }
    if (existingData.role === undefined) {
      updates.role = 'individual_creator';
      needsUpdate = true;
    }
    if (existingData.agencyMemberships === undefined) {
      updates.agencyMemberships = [];
      needsUpdate = true;
    }
    
    if (existingData.stripeCustomerId === undefined) { updates.stripeCustomerId = null; needsUpdate = true; }
    if (existingData.stripeSubscriptionId === undefined) { updates.stripeSubscriptionId = null; needsUpdate = true; }
    
    let currentSubscriptionStatus = existingData.subscriptionStatus;
    if (currentSubscriptionStatus === undefined) { 
      currentSubscriptionStatus = 'none'; 
      needsUpdate = true; 
    }
    updates.subscriptionStatus = currentSubscriptionStatus; 

    if (existingData.subscriptionInterval === undefined) { updates.subscriptionInterval = null; needsUpdate = true; }
    if (existingData.talentLimit === undefined) { updates.talentLimit = 0; needsUpdate = true; }


    if (existingData.trialEndsAt === undefined && (currentSubscriptionStatus === 'none' || currentSubscriptionStatus === 'trialing')) {
      const createdAt = existingData.createdAt || Timestamp.now();
      updates.trialEndsAt = new Timestamp(createdAt.seconds + 7 * 24 * 60 * 60, createdAt.nanoseconds);
      if (currentSubscriptionStatus === 'none') {
         updates.subscriptionStatus = 'trialing';
         updates.subscriptionPlanId = 'individual_monthly';
      }
      needsUpdate = true;
    } else if (existingData.trialEndsAt && existingData.trialEndsAt.toMillis() < Date.now() && currentSubscriptionStatus === 'trialing') {
      updates.subscriptionStatus = 'none'; 
      needsUpdate = true;
    }

    if (existingData.subscriptionEndsAt === undefined) { updates.subscriptionEndsAt = null; needsUpdate = true; }
    if (existingData.trialExtensionUsed === undefined) { updates.trialExtensionUsed = false; needsUpdate = true; }

    if (existingData.stripeAccountId === undefined) { updates.stripeAccountId = null; needsUpdate = true; }
    if (existingData.stripeAccountStatus === undefined) { updates.stripeAccountStatus = 'none'; needsUpdate = true; }
    if (existingData.stripeChargesEnabled === undefined) { updates.stripeChargesEnabled = false; needsUpdate = true; }
    if (existingData.stripePayoutsEnabled === undefined) { updates.stripePayoutsEnabled = false; needsUpdate = true; }

    if (existingData.hasCompletedOnboarding === undefined) {
      updates.hasCompletedOnboarding = false;
      needsUpdate = true;
    }
    if (existingData.isAgencyOwner === undefined) {
      updates.isAgencyOwner = false;
      needsUpdate = true;
    }
    if (existingData.credits === undefined) {
      updates.credits = NEW_USER_BONUS;
      needsUpdate = true;
    }

    if (existingData.showInMarketplace === undefined) { updates.showInMarketplace = false; needsUpdate = true; }
    if (existingData.niche === undefined) { updates.niche = ''; needsUpdate = true; }
    if (existingData.contentType === undefined) { updates.contentType = null; needsUpdate = true; }

    if (existingData.instagramConnected === undefined) { updates.instagramConnected = false; needsUpdate = true; }
    if (existingData.instagramFollowers === undefined) { updates.instagramFollowers = 0; needsUpdate = true; }
    if (existingData.instagramEngagement === undefined) { updates.instagramEngagement = 0; needsUpdate = true; }
    if (existingData.youtubeConnected === undefined) { updates.youtubeConnected = false; needsUpdate = true; }
    if (existingData.youtubeFollowers === undefined) { updates.youtubeFollowers = 0; needsUpdate = true; }
    if (existingData.youtubeEngagement === undefined) { updates.youtubeEngagement = 0; needsUpdate = true; }
    if (existingData.tiktokConnected === undefined) { updates.tiktokConnected = false; needsUpdate = true; }
    if (existingData.tiktokFollowers === undefined) { updates.tiktokFollowers = 0; needsUpdate = true; }
    if (existingData.tiktokEngagement === undefined) { updates.tiktokEngagement = 0; needsUpdate = true; }
    if (existingData.averageVerzaScore === undefined) { updates.averageVerzaScore = 0; needsUpdate = true; }
    if (existingData.socialContent === undefined) {
      updates.socialContent = {
        instagram: '',
        youtube: '',
        tiktok: '',
      };
      needsUpdate = true;
    }

    if (needsUpdate) {
      try {
        await setDoc(userDocRef, updates, { merge: true });
      } catch (error) {
        console.error("Error updating user document:", error);
      }
    }
  }
};


export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [firebaseUserInstance, setFirebaseUserInstance] = useState<FirebaseUser | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let unsubscribeFirestore: (() => void) | undefined;

    const authUnsubscribe = onAuthStateChanged(auth, async (currentFirebaseUser) => {
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
      }

      if (currentFirebaseUser) {
        setFirebaseUserInstance(currentFirebaseUser);
        await createUserDocument(currentFirebaseUser);

        const userDocRef = doc(db, 'users', currentFirebaseUser.uid);
        
        unsubscribeFirestore = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const firestoreUserData = docSnap.data() as UserProfile;
             let status = firestoreUserData.subscriptionStatus;
            if (status === 'trialing' && firestoreUserData.trialEndsAt && firestoreUserData.trialEndsAt.toMillis() < Date.now()) {
                status = 'none';
            }
            setUser({
              uid: currentFirebaseUser.uid,
              email: currentFirebaseUser.email,
              displayName: firestoreUserData.displayName || currentFirebaseUser.displayName,
              legalName: firestoreUserData.legalName || null,
              avatarUrl: firestoreUserData.avatarUrl || currentFirebaseUser.photoURL,
              companyLogoUrl: firestoreUserData.companyLogoUrl || null,
              emailVerified: currentFirebaseUser.emailVerified,
              address: firestoreUserData.address || null, 
              tin: firestoreUserData.tin || null,
              taxClassification: firestoreUserData.taxClassification || null,
              createdAt: firestoreUserData.createdAt,
              role: firestoreUserData.role || 'individual_creator',
              isAgencyOwner: firestoreUserData.isAgencyOwner || false,
              agencyMemberships: firestoreUserData.agencyMemberships || [],
              primaryAgencyId: firestoreUserData.primaryAgencyId || null,
              stripeCustomerId: firestoreUserData.stripeCustomerId,
              stripeSubscriptionId: firestoreUserData.stripeSubscriptionId,
              subscriptionStatus: status,
              subscriptionPlanId: firestoreUserData.subscriptionPlanId,
              talentLimit: firestoreUserData.talentLimit,
              subscriptionInterval: firestoreUserData.subscriptionInterval,
              trialEndsAt: firestoreUserData.trialEndsAt,
              subscriptionEndsAt: firestoreUserData.subscriptionEndsAt,
              trialExtensionUsed: firestoreUserData.trialExtensionUsed,
              stripeAccountId: firestoreUserData.stripeAccountId,
              stripeAccountStatus: firestoreUserData.stripeAccountStatus,
              stripeChargesEnabled: firestoreUserData.stripeChargesEnabled,
              stripePayoutsEnabled: firestoreUserData.stripePayoutsEnabled,
              hasCompletedOnboarding: firestoreUserData.hasCompletedOnboarding || false,
              emailSequence: firestoreUserData.emailSequence,
              credits: firestoreUserData.credits,
              showInMarketplace: firestoreUserData.showInMarketplace,
              niche: firestoreUserData.niche,
              contentType: firestoreUserData.contentType || null,
              instagramConnected: firestoreUserData.instagramConnected,
              instagramFollowers: firestoreUserData.instagramFollowers,
              instagramEngagement: firestoreUserData.instagramEngagement,
              youtubeConnected: firestoreUserData.youtubeConnected,
              youtubeFollowers: firestoreUserData.youtubeFollowers,
              youtubeEngagement: firestoreUserData.youtubeEngagement,
              tiktokConnected: firestoreUserData.tiktokConnected,
              tiktokFollowers: firestoreUserData.tiktokFollowers,
              tiktokEngagement: firestoreUserData.tiktokEngagement,
              socialContent: firestoreUserData.socialContent,
              missionStatement: firestoreUserData.missionStatement,
              brandWishlist: firestoreUserData.brandWishlist,
              followers: firestoreUserData.followers,
              engagementRate: firestoreUserData.engagementRate,
              averageVerzaScore: firestoreUserData.averageVerzaScore,
            });
          } else {
             setUser(null);
          }
          setIsLoading(false);
        }, (error) => {
          console.error("Error listening to user document:", error);
          setUser(null);
          setIsLoading(false);
        });

      } else {
        setUser(null);
        setFirebaseUserInstance(null);
        setIsLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
      }
    };
  }, []);

  const refreshAuthUser = useCallback(async () => {
    const currentFbUser = auth.currentUser;
    if (currentFbUser) {
      await currentFbUser.reload();
    }
  }, []);


  const loginWithGoogle = async () => {
    try {
      setIsLoading(true);
      const provider = new FirebaseAuthGoogleAuthProvider(); 
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Error signing in with Google:", error);
      toast({ title: "Login Failed", description: error.message || "Could not sign in with Google.", variant: "destructive"});
      setUser(null);
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      await signOut(auth);
    } catch (error: any) {
      console.error("Error signing out:", error);
      toast({ title: "Logout Failed", description: error.message, variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithEmailAndPassword = async (email: string, password: string): Promise<string | null> => {
    setIsLoading(true);
    try {
      await firebaseSignInWithEmailAndPassword(auth, email, password);
      return null; 
    } catch (error: any) {
      console.error("Error signing in with email and password:", error);
      setUser(null); 
      setIsLoading(false); 
      switch (error.code) {
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          return 'Invalid email or password. Please try again.';
        case 'auth/invalid-email':
          return 'The email address is not valid.';
        default:
          return error.message || "An unexpected error occurred during login.";
      }
    }
  };

  const signupWithEmailAndPassword = async (email: string, password: string): Promise<string | null> => {
    setIsLoading(true);
    try {
      const userCredential = await firebaseCreateUserWithEmailAndPassword(auth, email, password);
      if (userCredential.user) {
        await sendEmailVerification(userCredential.user);
        toast({
          title: "Verification Email Sent",
          description: "Please check your inbox to verify your email address.",
          duration: 7000,
        });
      }
      return null; 
    } catch (error: any) {
      console.error("Error signing up with email and password:", error);
      setUser(null); 
      setIsLoading(false); 
      switch (error.code) {
        case 'auth/email-already-in-use':
          return 'This email address is already in use.';
        case 'auth/invalid-email':
          return 'The email address is not valid.';
        case 'auth/weak-password':
          return 'The password is too weak. It must be at least 6 characters.';
        default:
          return error.message || "An unexpected error occurred during sign up.";
      }
    }
  };

  const sendPasswordReset = async (email: string) => {
    setIsLoading(true);
    try {
      await firebaseSendPasswordResetEmail(auth, email);
      toast({
        title: "Password Reset Email Sent",
        description: "If an account exists for this email, a password reset link has been sent.",
      });
    } catch (error: any) {
      console.error("Error sending password reset email:", error);
      toast({
        title: "Password Reset Failed",
        description: error.message || "Could not send password reset email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const resendVerificationEmail = async (): Promise<string | null> => {
    if (firebaseUserInstance && !firebaseUserInstance.emailVerified) {
      setIsLoading(true);
      try {
        await sendEmailVerification(firebaseUserInstance);
        toast({
          title: "Verification Email Resent",
          description: "Please check your inbox.",
        });
        return null;
      } catch (error: any) {
        console.error("Error resending verification email:", error);
        toast({
          title: "Error Resending Email",
          description: error.message || "Could not resend verification email.",
          variant: "destructive",
        });
        return error.message || "Could not resend verification email.";
      } finally {
        setIsLoading(false);
      }
    } else if (firebaseUserInstance && firebaseUserInstance.emailVerified) {
      toast({
        title: "Email Already Verified",
        description: "Your email address is already verified.",
      });
      return null;
    }
    return "No user to send verification email to, or email already verified.";
  };


  const getUserIdToken = async (): Promise<string | null> => {
    if (firebaseUserInstance) {
      try {
        return await firebaseUserInstance.getIdToken(true);
      } catch (error) {
        console.error("Error getting ID token:", error);
        return null;
      }
    }
    return null;
  };

  const isAuthenticated = !!user;
  const isAgency = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';
  const isCreator = user?.role === 'individual_creator';

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      user,
      isAgency,
      isCreator,
      loginWithGoogle,
      logout,
      loginWithEmailAndPassword,
      signupWithEmailAndPassword,
      sendPasswordReset,
      resendVerificationEmail,
      isLoading,
      getUserIdToken,
      refreshAuthUser
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
