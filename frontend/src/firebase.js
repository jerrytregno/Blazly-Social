import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Get API key from env – set VITE_FIREBASE_API_KEY in frontend/.env
// Find it in Firebase Console → Project Settings → General → Your apps
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCfyFAJfYAspUD8TtopzBQ82tT2nP3nOjw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "blazly-social-51a89.firebaseapp.com",
  databaseURL: "https://blazly-social-51a89-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "blazly-social-51a89",
  storageBucket: "blazly-social-51a89.firebasestorage.app",
  messagingSenderId: "644375809096",
  appId: "1:644375809096:web:9d1abe1888f04d80e31c7d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export default app;
