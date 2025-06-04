
"use client";

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface SignUpFormProps {
  onSignUpError?: (error: string | null) => void; // Optional callback
}

export const SignUpForm: React.FC<SignUpFormProps> = ({ onSignUpError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [internalSignupError, setInternalSignupError] = useState<string | null>(null);
  const { signupWithEmailAndPassword, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setInternalSignupError(null);
    if (onSignUpError) onSignUpError(null);

    const error = await signupWithEmailAndPassword(email, password);
    if (error) {
      setInternalSignupError(error);
      if (onSignUpError) onSignUpError(error);
    }
    // If no error, onAuthStateChanged will handle redirect/user state
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {internalSignupError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sign Up Failed</AlertTitle>
          <AlertDescription>{internalSignupError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          type="email"
          id="signup-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          type="password"
          id="signup-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="•••••••• (min. 6 characters)"
          required
          minLength={6}
        />
      </div>
      <div>
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            'Sign Up'
          )}
        </Button>
      </div>
    </form>
  );
};
