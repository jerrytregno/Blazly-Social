import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth, api } from '../hooks/useAuth';
import { getUser, setUser, getUserProfile, setUserProfile, getIntegrations } from '../services/firestore';
import LoadingScreen from '../components/LoadingScreen';
import './Onboarding.css';

const STEPS = [
  { id: 1, title: 'Basic Info', key: 'basicInfo' },
  { id: 2, title: 'Business Details', key: 'businessDetails' },
  { id: 3, title: 'Business Profile Scraper', key: 'website' },
  { id: 4, title: 'AI Profile & Connect', key: 'profile' },
];

const PLATFORMS = [
  { id: 'linkedin', name: 'LinkedIn', color: '#0a66c2' },
  { id: 'facebook', name: 'Facebook', color: '#1877F2' },
  { id: 'twitter', name: 'X (Twitter)', color: '#1DA1F2', onboardingDisabled: true, onboardingNote: 'Connect from Integrations after setup — X(twitter) works after registering.'},
  { id: 'threads', name: 'Threads', color: '#000000' },
  { id: 'instagram', name: 'Instagram', color: '#E4405F' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [step, setStep] = useState(1);
  const [profileCompletion, setProfileCompletion] = useState(0);
  const [onboardingState, setOnboardingState] = useState(null);
  const [integrating, setIntegrating] = useState(null);

  // Form state
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [businessName, setBusinessName] = useState('');
  const [businessSummary, setBusinessSummary] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState('');
  const [usedSitemap, setUsedSitemap] = useState(false);
  const [integrations, setIntegrations] = useState([]);

  useEffect(() => {
    if (!loading && !user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    const load = async () => {
      const uid = auth.currentUser?.uid || user?.id;
      if (!uid) return;
      try {
        const [userDoc, profileDoc, intData] = await Promise.all([
          getUser(uid),
          getUserProfile(uid),
          getIntegrations(uid),
        ]);
        setIntegrations(intData);
        if (userDoc) {
          const s = userDoc.onboardingStep ?? 1;
          setStep(s > 4 ? 4 : s);
          setProfileCompletion(userDoc.profileCompletion ?? 0);
          setName(userDoc.name || '');
          setTimezone(userDoc.timezone || 'UTC');
        }
        if (profileDoc) {
          setBusinessName(profileDoc.businessName || '');
          setBusinessSummary(profileDoc.businessSummary || '');
          setWebsiteUrl(profileDoc.websiteUrl || '');
        }
      } catch (_) {}
    };
    if (user) load();
  }, [user]);

  const updateStep = async (newStep, skip = false) => {
    const uid = auth.currentUser?.uid || user?.id;
    if (!uid) return;
    try {
      const capped = Math.min(Math.max(newStep, 1), 4);
      await setUser(uid, { onboardingStep: capped, profileCompletion: Math.round((capped / 4) * 100) });
      setStep(capped);
      setProfileCompletion(Math.round((capped / 4) * 100));
    } catch (_) {}
  };

  const handleNext = async () => {
    if (step < 4) {
      await saveStepData();
      await updateStep(step + 1);
    } else {
      navigate('/home', { replace: true });
    }
  };

  const handleSkip = async () => {
    await updateStep(step + 1, true);
    if (step >= 4) navigate('/home', { replace: true });
  };

  const saveStepData = async () => {
    const uid = auth.currentUser?.uid || user?.id;
    if (!uid) return;
    try {
      if (step === 1) {
        await setUser(uid, { name: name.trim(), timezone });
      }
      if (step === 2) {
        await setUserProfile(uid, { businessName: businessName.trim() });
      }
    } catch (_) {}
  };

  const handleScrapeWebsite = async () => {
    const url = websiteUrl.trim();
    if (!url) return;

    // Validate URL format before hitting the server
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch (_) {
      setScrapeError('Please enter a valid URL starting with https:// or http://');
      return;
    }

    setScraping(true);
    setScrapeError('');
    setScrapeStatus('Checking sitemap…');
    setUsedSitemap(false);

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        if (attempt === 0) setScrapeStatus('Checking sitemap…');
        else setScrapeStatus(`Reading pages from ${url}…`);

        const res = await api('/profile/scrape', {
          method: 'POST',
          body: JSON.stringify({ websiteUrl: url }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.businessProfile) {
          const uid = auth.currentUser?.uid || user?.id;
          // Firestore save is best-effort — don't let a permission error trigger retries
          if (uid) {
            try { await setUserProfile(uid, data.businessProfile); } catch (_) {}
          }
          setBusinessName(data.businessProfile?.businessName || businessName);
          setBusinessSummary(data.businessProfile?.businessSummary || businessSummary);
          if (data.businessProfile?.usedSitemap) setUsedSitemap(true);
          setScrapeStatus('');
          setScraping(false);
          return;
        }

        // 4xx = bad URL / website blocked → no retry
        if (res.status >= 400 && res.status < 500) {
          setScrapeStatus('');
          setScrapeError(data.error || `Could not scrape this URL (${res.status}). Make sure it's a public website and the address is correct.`);
          setScraping(false);
          return;
        }

        // 5xx = server/scraping error → fall through to retry
        if (attempt >= MAX_RETRIES) {
          setScrapeStatus('');
          setScrapeError(data.error || 'Scraping failed after several attempts. You can skip this step and fill in your profile manually.');
          setScraping(false);
          return;
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          setScrapeStatus('');
          setScrapeError('Scraping timed out (10 minutes). The site may be too large or unreachable. You can skip and fill in manually.');
          setScraping(false);
          return;
        }
        if (attempt >= MAX_RETRIES) {
          setScrapeStatus('');
          setScrapeError(e.message || 'Scraping failed. Check your connection or skip this step.');
          setScraping(false);
          return;
        }
      }

      // Exponential backoff before next retry: 1s, 2s, 4s
      const backoff = Math.pow(2, attempt) * 1000;
      setScrapeStatus(`Retrying in ${backoff / 1000}s… (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, backoff));
    }

    setScrapeStatus('');
    setScraping(false);
  };

  const handleConnect = async (platformId) => {
    setIntegrating(platformId);
    try {
      const res = await api(`/auth/integrations/${platformId}`, {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      const url = data.redirectUrl || res.headers.get('Location');
      if (url) {
        const popup = window.open(url, 'oauth', 'width=600,height=700');
        if (!popup) window.location.href = url;
        const onMessage = async (e) => {
          if (e.data?.type === 'blazly-oauth-callback') {
            setIntegrating(null);
            window.removeEventListener('message', onMessage);
            if (!e.data?.error && e.data?.platform && e.data?.userId) {
              const { setIntegration } = await import('../services/firestore');
              await setIntegration(e.data.userId, e.data.platform, e.data);
              const fresh = await getIntegrations(e.data.userId);
              setIntegrations(fresh);
            }
          }
        };
        window.addEventListener('message', onMessage);
      } else {
        setIntegrating(null);
        alert(data.error || 'Failed to start connection.');
      }
    } catch (_) {
      setIntegrating(null);
      alert('Failed to start connection.');
    }
  };

  const getIntegration = (id) => integrations.find((i) => i.platform === id);

  if (loading || !user) {
    return (
      <div className="onboarding">
        <LoadingScreen />
      </div>
    );
  }

  const pct = Math.round(profileCompletion);
  const progress = (step / 4) * 100;

  return (
    <div className="onboarding">
      <div className="onboarding__topbar">
        <div className="onboarding__progress-wrap">
          <div className="onboarding__progress-bar" style={{ width: `${progress}%` }} />
          <span className="onboarding__step-label">Step {step} of 4</span>
        </div>
        <span className="onboarding__pct">{pct}% complete</span>
      </div>

      <div className="onboarding__card">
        <h1>{STEPS[step - 1]?.title}</h1>

        {step === 1 && (
          <>
            <p>Let's start with the basics.</p>
            <div className="onboarding__field">
              <label>Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="onboarding__field">
              <label>Timezone</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p>Tell us about your business.</p>
            <div className="onboarding__field">
              <label>Business name</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Acme Inc"
              />
            </div>
            <p className="onboarding__hint">We'll enrich this in the next step when you add your website.</p>
          </>
        )}

        {step === 3 && (
          <>
            <p>Add your website URL and we'll automatically fill in your brand profile.</p>
            <div className="onboarding__sitemap-notice">
              <span className="onboarding__sitemap-icon">🗺</span>
              <span>We check your sitemap first to gather richer content from multiple pages. Only publicly accessible pages are read.</span>
            </div>
            <div className="onboarding__field">
              <label>Website URL</label>
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                disabled={scraping}
              />
            </div>
            <button
              className="onboarding__btn-primary"
              onClick={handleScrapeWebsite}
              disabled={scraping || !websiteUrl.trim()}
            >
              {scraping ? 'Analyzing…' : 'Scrape & Analyze'}
            </button>
            {scraping && (
              <div className="onboarding__scrape-loader">
                <div className="onboarding__scrape-spinner" />
                <div className="onboarding__scrape-info">
                  <span className="onboarding__scrape-url">{websiteUrl}</span>
                  {scrapeStatus && <span className="onboarding__scrape-status">{scrapeStatus}</span>}
                </div>
              </div>
            )}
            {usedSitemap && !scraping && (
              <div className="onboarding__sitemap-success">
                Sitemap found — profile enriched from multiple pages.
              </div>
            )}
            {scrapeError && <p className="onboarding__error">{scrapeError}</p>}
            {businessSummary && (
              <div className="onboarding__summary">
                <strong>Extracted summary:</strong>
                <p>{businessSummary.slice(0, 200)}…</p>
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p>Connect at least one social account to get started, or skip to complete setup later from Integrations.</p>
            {businessSummary && (
              <div className="onboarding__summary onboarding__summary--full">
                <strong>Your brand summary</strong>
                <p>{businessSummary}</p>
              </div>
            )}
            <div className="onboarding__grid">
              {PLATFORMS.map((p) => {
                const int = getIntegration(p.id);
                const isDisabled = p.onboardingDisabled && !int;
                return (
                  <div key={p.id} className={`onboarding__item${isDisabled ? ' onboarding__item--disabled' : ''}`}>
                    <div className="onboarding__item-icon" style={{ color: p.color }}>{p.name[0]}</div>
                    <div className="onboarding__item-body">
                      <span className="onboarding__item-name">{p.name}</span>
                      {isDisabled && p.onboardingNote && (
                        <span className="onboarding__item-note">{p.onboardingNote}</span>
                      )}
                    </div>
                    {int ? (
                      <span className="onboarding__item-status">Connected</span>
                    ) : isDisabled ? (
                      <span className="onboarding__item-locked" title={p.onboardingNote}>After setup</span>
                    ) : (
                      <button
                        className="onboarding__btn-connect"
                        onClick={() => handleConnect(p.id)}
                        disabled={integrating === p.id}
                        style={{ backgroundColor: p.color }}
                      >
                        {integrating === p.id ? 'Connecting…' : 'Connect'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="onboarding__actions">
          <button className="onboarding__btn-skip" onClick={handleSkip}>
            Skip for now
          </button>
          <button
            className="onboarding__btn-primary onboarding__btn-next"
            onClick={handleNext}
            disabled={step === 3 && scraping}
            title={step === 3 && scraping ? 'Please wait for scraping to complete' : undefined}
          >
            {step < 5 ? 'Next' : 'Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
