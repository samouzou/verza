
"use client";

import { Button } from "@/components/ui/button";
import { SignUpForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoginPage() {
  const { 
    user, 
    loginWithGoogle, 
    loginWithEmailAndPassword, 
    isAuthenticated, 
    isLoading, 
    sendPasswordReset 
  } = useAuth();
  
  const [isSignUpView, setIsSignUpView] = useState(false);
  const [isPasswordResetView, setIsPasswordResetView] = useState(false);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signupError, setSignupError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleGoogleLogin = async () => {
    setLoginError(null);
    setSignupError(null);
    await loginWithGoogle();
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setSignupError(null);
    const error = await loginWithEmailAndPassword(email, password);
    if (error) {
      setLoginError(error);
    }
  };

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null); 
    setSignupError(null);
    await sendPasswordReset(resetEmail);
  };

  if (isLoading && !isAuthenticated) { // Show skeleton for initial loading before auth state is known
     return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div className="mb-4 flex justify-center">
              <Skeleton className="h-12 w-12 rounded-full" /> {/* Logo skeleton */}
            </div>
            <Skeleton className="h-8 w-3/4 mx-auto mb-2" /> {/* Title skeleton */}
            <Skeleton className="h-4 w-full mx-auto" /> {/* Description skeleton */}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" /> {/* Button skeleton */}
              <Skeleton className="h-px w-full my-2" /> {/* OR separator skeleton */}
              <Skeleton className="h-10 w-full" /> {/* Email input skeleton */}
              <Skeleton className="h-10 w-full" /> {/* Password input skeleton */}
              <Skeleton className="h-10 w-full" /> {/* Button skeleton */}
            </div>
            <Skeleton className="h-4 w-3/4 mx-auto mt-4" /> {/* Footer link skeleton */}
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (isLoading && isAuthenticated) { // Show spinner for brief redirection phase
     return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Redirecting...</p>
      </div>
    );
  }


  const renderPasswordResetView = () => (
    <form onSubmit={handlePasswordResetRequest} className="space-y-4">
      {loginError && ( 
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{loginError}</AlertDescription>
        </Alert>
      )}
      <p className="text-center text-muted-foreground">
        Enter your email address and we'll send you a link to reset your password.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="reset-email">Email</Label>
        <Input 
          id="reset-email" 
          type="email" 
          placeholder="you@example.com" 
          value={resetEmail} 
          onChange={(e) => setResetEmail(e.target.value)} 
          required 
        />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Send Reset Link"}
      </Button>
      <Button variant="link" type="button" onClick={() => { setIsPasswordResetView(false); setIsSignUpView(false); setLoginError(null); setSignupError(null); }} className="p-0 h-auto w-full">
        Back to Login
      </Button>
    </form>
  );

  const renderLoginView = () => (
    <>
      <p className="text-center text-muted-foreground">
        Access your dashboard by signing in.
      </p>
      {loginError && (
        <Alert variant="destructive" className="my-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Login Failed</AlertTitle>
          <AlertDescription>{loginError}</AlertDescription>
        </Alert>
      )}
      <Button onClick={handleGoogleLogin} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" size="lg" disabled={isLoading}>
        {isLoading && email === "" ? ( 
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 381.5 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path></svg>
        )}
        Sign in with Google
      </Button>

      <div className="flex items-center my-4">
        <div className="flex-grow border-t border-border"></div>
        <span className="flex-shrink mx-4 text-muted-foreground text-sm">OR</span>
        <div className="flex-grow border-t border-border"></div>
      </div>

      <form onSubmit={handleEmailLogin} className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="email-login">Email</Label>
          <Input id="email-login" type="email" placeholder="m@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password-login">Password</Label>
            <Button variant="link" type="button" onClick={() => { setIsPasswordResetView(true); setLoginError(null); setSignupError(null); }} className="p-0 h-auto text-xs">
              Forgot password?
            </Button>
          </div>
          <Input id="password-login" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && email !== "" ? ( 
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            "Sign In with Email"
          )}
        </Button>
      </form>

      <p className="mt-6 px-8 text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Button variant="link" type="button" onClick={() => { setIsSignUpView(true); setIsPasswordResetView(false); setLoginError(null); setSignupError(null);}} className="p-0 h-auto">
          Sign up with email
        </Button>
      </p>
    </>
  );

  const renderSignUpView = () => (
    <>
      <SignUpForm onSignUpError={setSignupError} />
      {signupError && (
         <Alert variant="destructive" className="my-4">
           <AlertTriangle className="h-4 w-4" />
           <AlertTitle>Sign Up Failed</AlertTitle>
           <AlertDescription>{signupError}</AlertDescription>
         </Alert>
      )}
      <p className="mt-6 px-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Button variant="link" type="button" onClick={() => { setIsSignUpView(false); setIsPasswordResetView(false); setLoginError(null); setSignupError(null);}} className="p-0 h-auto">
          Sign in
        </Button>
      </p>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            <svg width="48" height="48" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
             <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontSize="38" fontWeight="bold" fill="currentColor">V</text>
            </svg>
          </div>
          <CardTitle className="text-3xl font-bold">
            {isPasswordResetView ? "Reset Password" : isSignUpView ? "Create Account" : "Welcome to Verza"}
          </CardTitle>
          <CardDescription>
             {isPasswordResetView ? "Enter your email to receive a reset link." : isSignUpView ? "Sign up to manage your contracts." : "Smart contract management for creators."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {isPasswordResetView ? renderPasswordResetView() : (isSignUpView ? renderSignUpView() : renderLoginView())}
            
            {!isPasswordResetView && (
              <p className="mt-4 px-8 text-center text-sm text-muted-foreground">
                By continuing, you agree to our{" "}
                <Link href="#" className="underline underline-offset-4 hover:text-primary">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="#" className="underline underline-offset-4 hover:text-primary">
                  Privacy Policy
                </Link>
                .
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
