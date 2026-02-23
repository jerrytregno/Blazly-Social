import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import { googleProvider } from '../firebase';
import { useAuth, api } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import './Landing.css';

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
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';
      const body = isLogin
        ? { email, password }
        : { email, password, name: name.trim() };

      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFormError(data.error || 'Authentication failed');
        setSubmitting(false);
        return;
      }

      if (data.token) {
        localStorage.setItem('blazly_token', data.token);
      }
      window.location.href = data.isNew ? '/onboarding' : '/home';
    } catch (err) {
      console.error('Auth Error:', err);
      setFormError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      const res = await api('/auth/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        window.location.href = '/home';
      } else {
        setFormError('Could not sign in. Please try again.');
      }
    } catch (err) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setFormError(err?.message || 'Google sign-in failed');
      }
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
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </span>
            {googleLoading ? 'Signing in...' : (isLogin ? 'Continue with Google' : 'Sign up with Google')}
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
