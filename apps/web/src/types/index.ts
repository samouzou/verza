
import type { Timestamp as ClientTimestamp } from 'firebase/firestore';
export * from '@verza/types';

// Override the generic Timestamp with the client-specific one if needed, 
// or just ensure compatibility.
export type Timestamp = ClientTimestamp;
