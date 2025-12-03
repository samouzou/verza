// src/lib/firebase-error-emitter.ts
import { EventEmitter } from 'events';
import { FirestorePermissionError } from './firebase-errors';

// Extend EventEmitter to have typed events
interface TypedEventEmitter {
  on(event: 'permission-error', listener: (error: FirestorePermissionError) => void): this;
  emit(event: 'permission-error', error: FirestorePermissionError): boolean;
}

class TypedEventEmitter extends EventEmitter {}

// Create a singleton instance of the event emitter
export const errorEmitter = new TypedEventEmitter();
