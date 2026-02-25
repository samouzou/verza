'use client';

import { EventEmitter } from 'events';

// A simple event emitter for the client-side to handle global Firebase errors
class FirebaseErrorEmitter extends EventEmitter {}

export const errorEmitter = new FirebaseErrorEmitter();
