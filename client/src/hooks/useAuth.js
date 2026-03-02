import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getUser } from '../services/firestore';

const API = '/api';

/** Normalize user to a common shape for the app */
function normalizeUser(source, firestoreUser = null) {
  if (!source) return null;
  const fs = firestoreUser || {};
  const base = {
    id: source.id || source.uid || source._id,
    email: source.email || fs.email,
    name: source.name || fs.name,
    timezone: source.timezone ?? fs.timezone ?? 'UTC',
    profileCompletion: source.profileCompletion ?? fs.profileCompletion ?? 0,
    onboardingStep: source.onboardingStep ?? fs.onboardingStep ?? 1,
    profile: {
      name: source.name || [source.profile?.firstName, source.profile?.lastName].filter(Boolean).join(' ') || source.displayName || fs.profile?.name || '',
      firstName: source.profile?.firstName || fs.profile?.firstName || (source.name || source.displayName || '').split(' ')[0] || '',
      lastName: source.profile?.lastName || fs.profile?.lastName || (source.name || source.displayName || '').split(' ').slice(1).join(' ') || '',
      profilePicture: source.profile?.profilePicture || source.photoURL || source.picture || fs.profile?.profilePicture,
    },
  };
  if (fs.profile) {
    base.profile = { ...base.profile, ...fs.profile };
  }
  return base;
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      if (firebaseUser) {
        let firestoreUser = null;
        try {
          firestoreUser = await getUser(firebaseUser.uid);
        } catch (_) {}
        setUser(normalizeUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        }, firestoreUser));
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const logout = async () => {
    setUser(null);
    try {
      await signOut(auth);
    } catch (_) {}
    try {
      localStorage.removeItem('blazly_token');
      await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (_) {}
    window.location.href = '/';
  };

  return { user, loading, logout };
}

/** API helper - uses Firebase ID token */
export async function api(path, options = {}) {
  let token = null;
  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken().catch(() => null);
  }

  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(`${API}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !options._skipAuthRedirect && !path.startsWith('/auth/')) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/' && !window.location.pathname.startsWith('/onboarding')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = next ? `/?next=${next}` : '/';
    }
  }

  return res;
}
