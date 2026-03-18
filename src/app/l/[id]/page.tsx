
"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, AlertTriangle } from 'lucide-react';
import Image from 'next/image';

/**
 * @fileOverview Verza Affiliate Redirector
 * Tracks clicks and redirects users to the brand's destination URL.
 */

export default function AffiliateRedirectPage() {
  const params = useParams();
  const linkId = params.id as string;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linkId) return;

    const processRedirect = async () => {
      try {
        const linkDocRef = doc(db, 'affiliateLinks', linkId);
        const linkSnap = await getDoc(linkDocRef);

        if (linkSnap.exists()) {
          const data = linkSnap.data();
          
          // 1. Increment Clicks
          await updateDoc(linkDocRef, {
            clicks: increment(1)
          });

          // 2. Redirect to destination
          window.location.href = data.destinationUrl;
        } else {
          setError("This link is invalid or has expired.");
        }
      } catch (err) {
        console.error("Redirect error:", err);
        setError("An error occurred while processing your request.");
      }
    };

    processRedirect();
  }, [linkId]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <Image src="/verza-icon.svg" alt="Verza" width={64} height={48} className="animate-pulse" />
        </div>
        
        {!error ? (
          <>
            <h1 className="text-2xl font-bold">Verza Verified Connection</h1>
            <p className="text-muted-foreground animate-pulse">Redirecting you securely to the brand experience...</p>
            <div className="flex justify-center pt-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          </>
        ) : (
          <div className="p-6 border-2 border-destructive/20 rounded-xl bg-destructive/5 space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-destructive">Redirect Failed</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button 
              onClick={() => window.location.href = 'https://tryverza.com'}
              className="text-primary font-bold hover:underline"
            >
              Back to Verza Home
            </button>
          </div>
        )}
        
        <p className="text-[10px] text-muted-foreground pt-12 uppercase tracking-widest">
          Powered by Verza Infrastructure &bull; Secure Performance Routing
        </p>
      </div>
    </div>
  );
}
