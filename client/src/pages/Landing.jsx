import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { createUser, getUser, setUser } from '../services/firestore';
import LoadingScreen from '../components/LoadingScreen';
import './Landing.css';

const FIREBASE_ERRORS = {
  'auth/invalid-credential':       'Invalid email or password.',
  'auth/user-not-found':           'No account found with this email.',
  'auth/wrong-password':           'Incorrect password.',
  'auth/email-already-in-use':     'An account with this email already exists. Try signing in.',
  'auth/weak-password':            'Password must be at least 6 characters.',
  'auth/too-many-requests':        'Too many failed attempts. Please try again in a few minutes.',
  'auth/network-request-failed':   'Network error. Check your connection and try again.',
  'auth/user-disabled':            'This account has been disabled. Contact support.',
  'auth/invalid-email':            'Please enter a valid email address.',
  'auth/popup-closed-by-user':     null, // don't show error
  'auth/cancelled-popup-request':  null,
  'auth/popup-blocked':            'Your browser blocked the sign-in popup. Please allow popups for this site.',
};

function friendlyAuthError(err) {
  const code = err?.code || '';
  if (FIREBASE_ERRORS[code] !== undefined) return FIREBASE_ERRORS[code];
  const raw = err?.message || '';
  // Strip Firebase boilerplate like "Firebase: Error (auth/...)."
  const cleaned = raw.replace(/^Firebase:\s*/i, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '').trim();
  return cleaned || 'Something went wrong. Please try again.';
}

async function ensureUserDoc(fbUser) {
  const existing = await getUser(fbUser.uid);
  if (existing) return;
  await createUser(fbUser.uid, {
    email: fbUser.email,
    name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
    profile: {
      profilePicture: fbUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(fbUser.displayName || 'User')}&background=random`,
    },
    settings: { theme: 'light', notifications: true },
  });
}

export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const errorParam = searchParams.get('error');

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (user && !loading) navigate('/home', { replace: true });
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="landing">
        <LoadingScreen />
      </div>
    );
  }

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      if (isLogin) {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserDoc(cred.user);
        window.location.href = '/home';
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await createUser(cred.user.uid, {
          email: cred.user.email,
          name: name.trim() || cred.user.displayName || '',
          profile: {
            profilePicture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name.trim() || 'User')}&background=random`,
          },
          settings: { theme: 'light', notifications: true },
        });
        window.location.href = '/onboarding';
      }
    } catch (err) {
      console.error('Auth Error:', err);
      const msg = friendlyAuthError(err);
      if (msg) setFormError(msg);
    }
    setSubmitting(false);
  };

  const handleGoogleSignIn = async () => {
    setFormError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await ensureUserDoc(result.user);
      window.location.href = '/home';
    } catch (err) {
      const msg = friendlyAuthError(err);
      if (msg) setFormError(msg);
    }
    setGoogleLoading(false);
  };

  return (
    <div className="landing">
      <div className="landing__card">
        <div className="landing__logo">
          <span className="landing__logo-icon">B</span>
          <span className="landing__logo-text">Blazly</span>
        </div>

        <p className="landing__tagline">Social media automation — create & schedule in one place.</p>

        {(errorParam || formError) && (
          <div className="landing__error">
            {decodeURIComponent(errorParam || formError)}
          </div>
        )}

        <form className="landing__form" onSubmit={handleEmailAuth}>
          {!isLogin && (
            <input
              type="text"
              placeholder="Your name"
              className="landing__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}

          <input
            type="email"
            placeholder="Email address"
            className="landing__input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            className="landing__input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />

          <button
            type="submit"
            className="landing__cta landing__cta--primary"
            disabled={submitting}
          >
            {submitting ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
          </button>

          <div className="landing__divider">or</div>

          <button
            type="button"
            className="landing__cta landing__cta--google"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
          >
            <span className="landing__google-icon">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            </span>
            {googleLoading ? 'Signing in...' : 'Continue with Google'}
          </button>
        </form>

        <div className="landing__toggle">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="landing__toggle-btn"
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setFormError('');
            }}
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
      <div className="landing__bg" aria-hidden />
    </div>
  );
}
