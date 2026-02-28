import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, api } from '../hooks/useAuth';
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
  { id: 'twitter', name: 'Twitter', color: '#000000' },
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
  const [integrations, setIntegrations] = useState([]);

  useEffect(() => {
    if (!loading && !user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    const load = async () => {
      try {
        const [onboardRes, profileRes, intRes] = await Promise.all([
          api('/onboarding'),
          api('/profile'),
          api('/integrations'),
        ]);
        if (onboardRes.ok) {
          const d = await onboardRes.json();
          const s = d.step || 1;
          setStep(s > 4 ? 4 : s);
          setProfileCompletion(d.profileCompletion || 0);
          setOnboardingState(d);
        }
        if (profileRes.ok) {
          const p = await profileRes.json();
          setName(p.account?.name || '');
          setTimezone(p.account?.timezone || 'UTC');
          setBusinessName(p.businessProfile?.businessName || '');
          setBusinessSummary(p.businessProfile?.businessSummary || '');
          setWebsiteUrl(p.businessProfile?.websiteUrl || '');
        }
        if (intRes.ok) setIntegrations(await intRes.json());
      } catch (_) {}
    };
    if (user) load();
  }, [user]);

  const updateStep = async (newStep, skip = false) => {
    try {
      const res = await api('/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({ step: newStep, skip }),
      });
      if (res.ok) {
        const d = await res.json();
        setStep(d.step);
        setProfileCompletion(d.profileCompletion);
      }
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
    try {
      if (step === 1) {
        await api('/me', {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), timezone }),
        });
      }
      if (step === 2) {
        await api('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            businessName: businessName.trim(),
          }),
        });
      }
    } catch (_) {}
  };

  const handleScrapeWebsite = async () => {
    if (!websiteUrl.trim()) return;
    setScraping(true);
    setScrapeError('');
    try {
      const res = await api('/profile/scrape', {
        method: 'POST',
        body: JSON.stringify({ websiteUrl: websiteUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setBusinessName(data.businessProfile?.businessName || businessName);
        setBusinessSummary(data.businessProfile?.businessSummary || businessSummary);
      } else {
        setScrapeError(data.error || 'Scraping failed');
      }
    } catch (e) {
      setScrapeError(e.message || 'Scraping failed');
    }
    setScraping(false);
  };

  const handleConnect = async (platformId) => {
    setIntegrating(platformId);
    try {
      await api('/auth/session', { method: 'POST' });
      window.location.href = `/api/auth/integrations/${platformId}`;
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
            <p>Add your website URL. We'll scrape it to identify your business details and fill the profile questions automatically.</p>
            <div className="onboarding__field">
              <label>Website URL</label>
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourcompany.com"
              />
            </div>
            <button
              className="onboarding__btn-primary"
              onClick={handleScrapeWebsite}
              disabled={scraping || !websiteUrl.trim()}
            >
              {scraping ? 'Scraping…' : 'Scrape & Analyze'}
            </button>
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
                return (
                  <div key={p.id} className="onboarding__item">
                    <div className="onboarding__item-icon" style={{ color: p.color }}>{p.name[0]}</div>
                    <span className="onboarding__item-name">{p.name}</span>
                    {int ? (
                      <span className="onboarding__item-status">Connected</span>
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
          <button className="onboarding__btn-primary onboarding__btn-next" onClick={handleNext}>
            {step < 5 ? 'Next' : 'Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
