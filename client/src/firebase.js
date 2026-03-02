import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Set VITE_FIREBASE_* in .env to match your Firebase project (e.g. blazly)
// Firebase Console → Project Settings → General → Your apps → Web app config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCfyFAJfYAspUD8TtopzBQ82tT2nP3nOjw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "blazly-social-51a89.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://blazly-social-51a89-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "blazly-social-51a89",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "blazly-social-51a89.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "644375809096",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:644375809096:web:31ce839760edca00e31c7d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export default app;
