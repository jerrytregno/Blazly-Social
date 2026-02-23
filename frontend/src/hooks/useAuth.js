import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const API = '/api';

/** Normalize user to a common shape for the app */
function normalizeUser(source) {
  if (!source) return null;
  const base = {
    id: source.id || source.uid || source._id,
    email: source.email,
    name: source.name,
    timezone: source.timezone ?? 'UTC',
    profileCompletion: source.profileCompletion ?? 0,
    onboardingStep: source.onboardingStep ?? 1,
    profile: {
      name: source.name || [source.profile?.firstName, source.profile?.lastName].filter(Boolean).join(' ') || source.displayName || '',
      firstName: source.profile?.firstName || (source.name || source.displayName || '').split(' ')[0] || '',
      lastName: source.profile?.lastName || (source.name || source.displayName || '').split(' ').slice(1).join(' ') || '',
      profilePicture: source.profile?.profilePicture || source.photoURL || source.picture,
    },
  };
  if (source.profile) {
    const fullName = source.name || [source.profile?.firstName, source.profile?.lastName].filter(Boolean).join(' ') || base.profile.name;
    base.profile.name = fullName;
    base.profile.firstName = source.profile.firstName ?? fullName.split(' ')[0];
    base.profile.lastName = source.profile.lastName ?? fullName.split(' ').slice(1).join(' ');
    base.profile.profilePicture = source.profile.profilePicture || base.profile.profilePicture;
  }
  return base;
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState(null); // 'firebase' | 'session'

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const res = await fetch(`${API}/me`, { credentials: 'include' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setUser(normalizeUser(data));
          setAuthMode('session');
          return true;
        }
      } catch (_) {}
      return false;
    };

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      if (firebaseUser) {
        setUser(normalizeUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        }));
        setAuthMode('firebase');
      } else {
        const hasSession = await checkSession();
        if (!hasSession) setUser(null);
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
    setAuthMode(null);
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

export async function api(path, options = {}) {
  let token = null;
  const jwtToken = typeof localStorage !== 'undefined' ? localStorage.getItem('blazly_token') : null;
  if (jwtToken) {
    token = jwtToken;
  } else if (auth.currentUser) {
    token = await auth.currentUser.getIdToken().catch(() => null);
  }

  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !options._skipAuthRedirect && !path.startsWith('/me')) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/' && !window.location.pathname.startsWith('/onboarding')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = next ? `/?next=${next}` : '/';
    }
  }

  return res;
}
