// src/components/firebase-error-listener.tsx
'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/lib/firebase-error-emitter';

export function FirebaseErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handlePermissionError = (error: Error) => {
      console.error('Caught Firestore Permission Error:', error);
      toast({
        variant: 'destructive',
        title: 'Permission Denied',
        description: (
            <pre className="mt-2 w-full rounded-md bg-slate-950 p-4">
                <code className="text-white whitespace-pre-wrap">{error.message}</code>
            </pre>
        ),
        duration: 20000,
      });
    };

    errorEmitter.on('permission-error', handlePermissionError);

    return () => {
      errorEmitter.removeListener('permission-error', handlePermissionError);
    };
  }, [toast]);

  return null; // This component does not render anything
}
