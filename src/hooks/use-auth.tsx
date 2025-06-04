
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
  type FirebaseUser,
  db,
  doc,
  setDoc,
  getDoc,
  Timestamp,
} from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";


export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  address?: string | null; // Added user address
  createdAt?: Timestamp;

  // Subscription Fields
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  trialEndsAt?: Timestamp | null;
  subscriptionEndsAt?: Timestamp | null;
  trialExtensionUsed?: boolean;

  // Stripe Connected Account Fields
  stripeAccountId?: string | null;
  stripeAccountStatus?: 'none' | 'onboarding_incomplete' | 'pending_verification' | 'active' | 'restricted' | 'restricted_soon';
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: UserProfile | null;
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

    updates.uid = uid;
    updates.email = email;
    updates.displayName = displayName || email?.split('@')[0] || 'User';
    updates.avatarUrl = photoURL || null;
    updates.emailVerified = emailVerified;
    updates.address = null; // Initialize address
    updates.createdAt = createdAt;

    updates.stripeCustomerId = null;
    updates.stripeSubscriptionId = null;
    updates.subscriptionStatus = 'trialing';
    updates.trialEndsAt = trialEndsAtTimestamp;
    updates.subscriptionEndsAt = null;
    updates.trialExtensionUsed = false;

    updates.stripeAccountId = null;
    updates.stripeAccountStatus = 'none';
    updates.stripeChargesEnabled = false;
    updates.stripePayoutsEnabled = false;

    needsUpdate = true;

    try {
      await setDoc(userDocRef, updates);
      // console.log("User document created in Firestore for UID:", uid);
    } catch (error) {
      console.error("Error creating user document in Firestore:", error);
    }
  } else {
    const existingData = userDocSnap.data() as UserProfile;

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
    if (existingData.address === undefined) { // Check for address
      updates.address = null;
      needsUpdate = true;
    }
    
    // Initialize subscription fields if missing
    if (existingData.stripeCustomerId === undefined) { updates.stripeCustomerId = null; needsUpdate = true; }
    if (existingData.stripeSubscriptionId === undefined) { updates.stripeSubscriptionId = null; needsUpdate = true; }
    
    let currentSubscriptionStatus = existingData.subscriptionStatus;
    if (currentSubscriptionStatus === undefined) { 
      currentSubscriptionStatus = 'none'; 
      needsUpdate = true; 
    }
    updates.subscriptionStatus = currentSubscriptionStatus; 

    if (existingData.trialEndsAt === undefined && (currentSubscriptionStatus === 'none' || currentSubscriptionStatus === 'trialing')) {
      const createdAt = existingData.createdAt || Timestamp.now();
      updates.trialEndsAt = new Timestamp(createdAt.seconds + 7 * 24 * 60 * 60, createdAt.nanoseconds);
      if (currentSubscriptionStatus === 'none') {
         updates.subscriptionStatus = 'trialing';
      }
      needsUpdate = true;
    } else if (existingData.trialEndsAt && existingData.trialEndsAt.toMillis() < Date.now() && currentSubscriptionStatus === 'trialing') {
      updates.subscriptionStatus = 'none'; 
      needsUpdate = true;
    }

    if (existingData.subscriptionEndsAt === undefined) { updates.subscriptionEndsAt = null; needsUpdate = true; }
    if (existingData.trialExtensionUsed === undefined) { updates.trialExtensionUsed = false; needsUpdate = true; }

    // Initialize Stripe Connect fields if missing
    if (existingData.stripeAccountId === undefined) { updates.stripeAccountId = null; needsUpdate = true; }
    if (existingData.stripeAccountStatus === undefined) { updates.stripeAccountStatus = 'none'; needsUpdate = true; }
    if (existingData.stripeChargesEnabled === undefined) { updates.stripeChargesEnabled = false; needsUpdate = true; }
    if (existingData.stripePayoutsEnabled === undefined) { updates.stripePayoutsEnabled = false; needsUpdate = true; }


    if (needsUpdate) {
      try {
        await setDoc(userDocRef, updates, { merge: true });
        // console.log("User document updated for UID:", firebaseUser.uid, "with updates:", updates);
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

  const fetchAndSetUser = useCallback(async (currentFirebaseUser: FirebaseUser | null) => {
    if (currentFirebaseUser) {
      setFirebaseUserInstance(currentFirebaseUser);
      await createUserDocument(currentFirebaseUser);

      const userDocRef = doc(db, 'users', currentFirebaseUser.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        const firestoreUserData = userDocSnap.data() as UserProfile;
        setUser({
          uid: currentFirebaseUser.uid,
          email: currentFirebaseUser.email,
          displayName: firestoreUserData.displayName || currentFirebaseUser.displayName,
          avatarUrl: firestoreUserData.avatarUrl || currentFirebaseUser.photoURL,
          emailVerified: currentFirebaseUser.emailVerified,
          address: firestoreUserData.address || null, // Populate address
          createdAt: firestoreUserData.createdAt,
          stripeCustomerId: firestoreUserData.stripeCustomerId,
          stripeSubscriptionId: firestoreUserData.stripeSubscriptionId,
          subscriptionStatus: firestoreUserData.subscriptionStatus,
          trialEndsAt: firestoreUserData.trialEndsAt,
          subscriptionEndsAt: firestoreUserData.subscriptionEndsAt,
          trialExtensionUsed: firestoreUserData.trialExtensionUsed,
          stripeAccountId: firestoreUserData.stripeAccountId,
          stripeAccountStatus: firestoreUserData.stripeAccountStatus,
          stripeChargesEnabled: firestoreUserData.stripeChargesEnabled,
          stripePayoutsEnabled: firestoreUserData.stripePayoutsEnabled,
        });
      } else {
         console.warn(`User document for ${currentFirebaseUser.uid} not found. This might be an initial sync issue.`);
         setUser({
          uid: currentFirebaseUser.uid,
          email: currentFirebaseUser.email,
          displayName: currentFirebaseUser.displayName,
          avatarUrl: currentFirebaseUser.photoURL,
          emailVerified: currentFirebaseUser.emailVerified,
          address: null, // Default address
          createdAt: Timestamp.now(), 
          subscriptionStatus: 'none',
          stripeAccountStatus: 'none',
        });
      }
    } else {
      setUser(null);
      setFirebaseUserInstance(null);
    }
    setIsLoading(false);
  }, []);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentFirebaseUser) => {
      await fetchAndSetUser(currentFirebaseUser);
    });
    return () => unsubscribe();
  }, [fetchAndSetUser]);

  const refreshAuthUser = useCallback(async () => {
    const currentFbUser = auth.currentUser;
    if (currentFbUser) {
      setIsLoading(true);
      await currentFbUser.reload();
      const refreshedFirebaseUser = auth.currentUser;
      if (refreshedFirebaseUser) {
        await fetchAndSetUser(refreshedFirebaseUser);
      } else {
         setIsLoading(false);
      }
    }
  }, [fetchAndSetUser]);


  const loginWithGoogle = async () => {
    try {
      setIsLoading(true);
      const provider = new FirebaseAuthGoogleAuthProvider(); // Use renamed import
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
    console.warn("getUserIdToken called but no Firebase user instance is available.");
    return null;
  };

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      user,
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
