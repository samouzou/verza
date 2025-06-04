
import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  type User as FirebaseUser
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  Timestamp,
  query,
  orderBy,
  where,
  deleteDoc,
  updateDoc,
  writeBatch,
  onSnapshot,
  arrayUnion // Added arrayUnion
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfigValues = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if essential config values are present
if (!firebaseConfigValues.apiKey || !firebaseConfigValues.projectId) {
  const missingKeys = [];
  if (!firebaseConfigValues.apiKey) missingKeys.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!firebaseConfigValues.projectId) missingKeys.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");

  throw new Error(
    `Firebase configuration error: The following environment variables are missing: ${missingKeys.join(", ")}. ` +
    "Please ensure they are set in your .env.local file (for local development) or in your hosting provider's environment settings. " +
    "The application cannot connect to Firebase without them."
  );
}


const firebaseConfig: FirebaseOptions = firebaseConfigValues;

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);
const googleAuthProvider = new GoogleAuthProvider();


export {
  app,
  auth,
  db,
  storage,
  functions,
  GoogleAuthProvider,
  googleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  type FirebaseUser,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  Timestamp,
  query,
  orderBy,
  where,
  deleteDoc,
  updateDoc,
  writeBatch,
  onSnapshot,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  arrayUnion // Export arrayUnion
};
