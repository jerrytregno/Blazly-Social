import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth, api } from '../hooks/useAuth';
import { getUser, setUser, getUserProfile, setUserProfile, getIntegrations } from '../services/firestore';
import LoadingScreen from '../components/LoadingScreen';
import KeywordPicker from '../components/KeywordPicker';
import './Profile.css';

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'];

export default function Profile() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Full profile data
  const [account, setAccount] = useState({ name: '', email: '', timezone: 'UTC', profileCompletion: 0 });
  const [businessProfile, setBusinessProfile] = useState(null);
  const [scraping, setScraping] = useState({ lastScrapedAt: null, competitorCount: 0 });
  const [integrations, setIntegrations] = useState([]);

  // Editable state
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [businessName, setBusinessName] = useState('');
  const [businessSummary, setBusinessSummary] = useState('');
  const [brandTone, setBrandTone] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [targetAudience, setTargetAudience] = useState('');
  const [valueProposition, setValueProposition] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');

  // Password change
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Scraping
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapingInProgress, setScrapingInProgress] = useState(false);
  const [scrapeError, setScrapeError] = useState('');

  // AI instructions (existing)
  const [aiInstructions, setAiInstructions] = useState({ global: '', useGlobalForAll: true, platforms: {} });

  // Profile Optimizer
  const [optimizerData, setOptimizerData] = useState([]);
  const [optimizerLoading, setOptimizerLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const uid = auth.currentUser?.uid || user?.id;
      if (!uid) return setLoading(false);
      // Use allSettled so one failed load doesn't prevent others from updating state
      const [userResult, profileResult, intResult] = await Promise.allSettled([
        getUser(uid),
        getUserProfile(uid),
        getIntegrations(uid),
      ]);
      if (intResult.status === 'fulfilled') {
        const intData = intResult.value || [];
        setIntegrations(intData);
        if (intData.length > 0) {
          api('/profile/optimizer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrations: intData }),
        }).then((r) => r.ok && r.json()).then((d) => d?.platforms && setOptimizerData(d.platforms)).catch(() => {});
        }
      }
      if (userResult.status === 'fulfilled' && userResult.value) {
        const userDoc = userResult.value;
        setAccount({
          name: userDoc.name || '',
          email: userDoc.email,
          timezone: userDoc.timezone || 'UTC',
          profileCompletion: userDoc.profileCompletion ?? 0,
          onboardingStep: userDoc.onboardingStep ?? 1,
        });
        setName(userDoc.name || '');
        setTimezone(userDoc.timezone || 'UTC');
        setAiInstructions(userDoc.aiInstructions || { global: '', useGlobalForAll: true, platforms: {} });
      }
      if (profileResult.status === 'fulfilled' && profileResult.value) {
        const profileDoc = profileResult.value;
        setBusinessProfile(profileDoc);
        setBusinessName(profileDoc.businessName || '');
        setBusinessSummary(profileDoc.businessSummary || '');
        setBrandTone(profileDoc.brandTone || '');
        setKeywords(profileDoc.keywords || []);
        setTargetAudience(profileDoc.targetAudience || '');
        setValueProposition(profileDoc.valueProposition || '');
        setWebsiteUrl(profileDoc.websiteUrl || '');
        setScrapeUrl(profileDoc.websiteUrl || '');
        setScraping((s) => ({ ...s, lastScrapedAt: profileDoc.lastScrapedAt, competitorCount: 0 }));
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  const handleSaveAccount = async () => {
    const uid = auth.currentUser?.uid || user?.id;
    if (!uid) return;
    setSaving(true);
    try {
      await setUser(uid, { name: name.trim(), timezone });
      await setUserProfile(uid, {
        businessName: businessName.trim(),
        businessSummary: businessSummary.trim(),
        brandTone: brandTone.trim(),
        keywords: Array.isArray(keywords) ? keywords : (typeof keywords === 'string' ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : keywords),
        targetAudience: targetAudience.trim(),
        valueProposition: valueProposition.trim(),
      });
      setAccount((a) => ({ ...a, name: name.trim(), timezone }));
    } catch (_) {}
    setSaving(false);
  };

  const handleScrape = async () => {
    const url = scrapeUrl.trim() || websiteUrl;
    if (!url) return;
    setScrapingInProgress(true);
    setScrapeError('');
    try {
      const res = await api('/profile/scrape', {
        method: 'POST',
        body: JSON.stringify({ websiteUrl: url }),
      });
      const data = await res.json();
      if (res.ok && data.businessProfile) {
        const uid = auth.currentUser?.uid || user?.id;
        const bp = { ...data.businessProfile, websiteUrl: data.businessProfile.websiteUrl || url };
        // Always save to client Firestore (handles both normal + clientSave mode)
        if (uid) {
          await setUserProfile(uid, bp).catch(() => {});
        }
        setBusinessProfile(bp);
        setBusinessName(bp.businessName || '');
        setBusinessSummary(bp.businessSummary || '');
        setBrandTone(bp.brandTone || '');
        setKeywords(bp.keywords || []);
        setTargetAudience(bp.targetAudience || '');
        setValueProposition(bp.valueProposition || '');
        setWebsiteUrl(bp.websiteUrl || url);
        setScraping((s) => ({ ...s, lastScrapedAt: bp.lastScrapedAt || new Date() }));
      } else {
        setScrapeError(data.error || 'Scraping failed');
      }
    } catch (e) {
      setScrapeError(e.message || 'Failed');
    }
    setScrapingInProgress(false);
  };

  const handlePasswordChange = async () => {
    setPasswordError('');
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      setPasswordError('Current password and new password (min 6 chars) required');
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await api('/profile/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowPasswordModal(false);
        setCurrentPassword('');
        setNewPassword('');
      } else {
        setPasswordError(data.error || 'Failed');
      }
    } catch (_) {
      setPasswordError('Failed');
    }
    setPasswordSaving(false);
  };

  if (loading) {
    return (
      <div className="profile-loading profile-loading--thin">
        <div className="profile-loading-bar">
          <div className="profile-loading-fill" />
        </div>
        <span className="profile-loading-pct">Loading…</span>
      </div>
    );
  }

  const sections = [
    { id: 'account', label: 'Account' },
    { id: 'business', label: 'Business Profile' },
    { id: 'scraper', label: 'Scraper' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'optimizer', label: 'Profile Optimizer' },
    { id: 'ai', label: 'AI Instructions' },
  ];

  return (
    <div className="profile-page">
      <header className="profile-header">
        <button className="profile-back" onClick={() => navigate('/home')}>← Back</button>
        <h1>Profile & Settings</h1>
      </header>

      <div className="profile-layout">
        <aside className="profile-sections-nav">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`profile-section-link ${(hash || '#account').replace('#', '') === s.id ? 'profile-section-link--active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                window.history.replaceState(null, '', `#${s.id}`);
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {s.label}
            </a>
          ))}
        </aside>
        <div className="profile-content">
      {/* A. Account */}
      <section id="account" className="profile-section">
        <h2>Account</h2>
        <div className="profile-completion-bar">
          <div className="profile-completion-bar-track">
            <div className="profile-completion-fill" style={{ width: `${account.profileCompletion || 0}%` }} />
          </div>
          <span className="profile-completion-label">{account.profileCompletion ?? 0}%</span>
        </div>
        <div className="profile-field">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>
        <div className="profile-field">
          <label>Email</label>
          <input type="email" value={account.email} disabled readOnly className="profile-field--readonly" />
        </div>
        <div className="profile-field">
          <label>Password</label>
          <input type="password" value="••••••••" disabled readOnly className="profile-field--readonly" />
          <button className="profile-link" onClick={() => setShowPasswordModal(true)}>Change password</button>
        </div>
        <div className="profile-field">
          <label>Timezone</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="UTC">UTC</option>
            <option value="America/New_York">Eastern</option>
            <option value="America/Chicago">Central</option>
            <option value="America/Denver">Mountain</option>
            <option value="America/Los_Angeles">Pacific</option>
            <option value="Europe/London">London</option>
            <option value="Europe/Paris">Paris</option>
            <option value="Asia/Tokyo">Tokyo</option>
            <option value="Asia/Kolkata">India</option>
          </select>
        </div>
      </section>

      {/* B. Business Profile */}
      <section id="business" className="profile-section">
        <h2>Business Profile</h2>
        <p className="profile-desc">Editable fields from AI-generated analysis.</p>
        <div className="profile-field">
          <label>Business name</label>
          <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        </div>
        <div className="profile-field">
          <label>Business summary</label>
          <textarea
            value={businessSummary}
            onChange={(e) => setBusinessSummary(e.target.value)}
            rows={4}
            placeholder="2-4 sentence summary..."
          />
        </div>
        <div className="profile-field">
          <label>Tone</label>
          <input type="text" value={brandTone} onChange={(e) => setBrandTone(e.target.value)} placeholder="e.g. professional, casual" />
        </div>
        <div className="profile-field">
          <label>Target audience</label>
          <input type="text" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
        </div>
        <div className="profile-field">
          <label>Keywords</label>
          <KeywordPicker value={keywords} onChange={setKeywords} placeholder="Type to add (e.g. marketing, content)" maxKeywords={25} />
        </div>
        <div className="profile-field">
          <label>Value proposition</label>
          <textarea value={valueProposition} onChange={(e) => setValueProposition(e.target.value)} rows={2} />
        </div>
        <button className="profile-save" onClick={handleSaveAccount} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </section>

      {/* C. Business Profile Scraper */}
      <section id="scraper" className="profile-section">
        <h2>Business Profile Scraper</h2>
        <p className="profile-desc">Scrape your website to identify business details and auto-fill your profile.</p>
        {scraping.lastScrapedAt && (
          <p className="profile-desc">Last scraped: {new Date(scraping.lastScrapedAt).toLocaleString()}</p>
        )}
        <div className="profile-field">
          <label>Website URL</label>
          <input
            type="url"
            value={scrapeUrl}
            onChange={(e) => setScrapeUrl(e.target.value)}
            placeholder="https://yourcompany.com"
          />
        </div>
        <div className="profile-scrape-actions">
          <button
            className="profile-save"
            onClick={handleScrape}
            disabled={scrapingInProgress || !scrapeUrl.trim()}
          >
            {scrapingInProgress ? 'Scraping…' : 'Rescrape Website'}
          </button>
          <button className="profile-btn-secondary" onClick={() => navigate('/profile/competitors')}>
            Competitor Scraper & Analysis
          </button>
        </div>
        {scrapeError && <p className="profile-error">{scrapeError}</p>}
      </section>

      {/* Integrations */}
      <section id="integrations" className="profile-section">
        <h2>Integrations</h2>
        <div className="profile-integrations">
          {PLATFORMS.map((pl) => {
            const int = integrations.find((i) => i.platform === pl);
            return (
              <div key={pl} className="profile-integration-item">
                <span className="profile-int-name">{pl}</span>
                {int ? (
                  <span className="profile-int-status connected">Connected</span>
                ) : (
                  <button
                    className="profile-int-connect"
                    onClick={() => {
                      api('/auth/session', { method: 'POST' }).then(() => {
                        window.location.href = `/api/auth/integrations/${pl}`;
                      });
                    }}
                  >
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Profile Optimizer */}
      <section id="optimizer" className="profile-section">
        <h2>Profile Optimizer</h2>
        <p className="profile-desc">
          AI-powered suggestions to optimize your profile for each connected platform. Based on your business profile and platform best practices.
        </p>
        {integrations.length === 0 ? (
          <p className="profile-desc">Connect platforms in Integrations above to get personalized profile suggestions.</p>
        ) : (
          <>
            <button
              className="profile-save"
              style={{ marginBottom: 16 }}
              onClick={async () => {
                setOptimizerLoading(true);
                try {
                  const r = await api('/profile/optimizer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ integrations }),
                  });
                  if (r.ok) {
                    const d = await r.json();
                    setOptimizerData(d.platforms || []);
                  }
                } catch (_) {}
                setOptimizerLoading(false);
              }}
              disabled={optimizerLoading}
            >
              {optimizerLoading ? 'Loading…' : 'Refresh suggestions'}
            </button>
            <div className="profile-optimizer-grid">
              {optimizerData.map((p) => (
                <div key={p.platform} className="profile-optimizer-card">
                  <div className="profile-optimizer-header">
                    <h3>{p.platformName}</h3>
                    {p.pageName && <span className="profile-optimizer-page">{p.pageName}</span>}
                  </div>
                  {(p.permissions?.public_profile_desc || p.permissions?.profile_desc) && (
                    <p className="profile-optimizer-perms">
                      <strong>API:</strong> {p.permissions.public_profile_desc || p.permissions.profile_desc}
                    </p>
                  )}
                  <ul className="profile-optimizer-list">
                    {p.suggestions?.map((s, i) => (
                      <li key={i} className="profile-optimizer-item">
                        <span className="profile-optimizer-field">{s.field}</span>
                        {s.current && <span className="profile-optimizer-current">Current: {s.current}</span>}
                        <span className="profile-optimizer-suggested">Suggested: {s.suggested}</span>
                        <span className="profile-optimizer-reason">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {(!p.suggestions || p.suggestions.length === 0) && (
                    <p className="profile-desc">Complete your Business Profile for better suggestions.</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* AI Custom Instructions */}
      <section id="ai" className="profile-section">
        <h2>AI Custom Instructions</h2>
        <textarea
          className="profile-textarea"
          placeholder="E.g. Write in a friendly tone. Use industry examples."
          value={aiInstructions.global}
          onChange={(e) => setAiInstructions((p) => ({ ...p, global: e.target.value }))}
          rows={4}
        />
        <button
          className="profile-save"
          onClick={async () => {
            setSaving(true);
            await api('/me', { method: 'PATCH', body: JSON.stringify({ aiInstructions }) });
            setSaving(false);
          }}
        >
          Save Instructions
        </button>
      </section>
        </div>
      </div>

      {showPasswordModal && (
        <div className="profile-modal-overlay" onClick={() => !passwordSaving && setShowPasswordModal(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Change password</h3>
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="New password (min 6 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {passwordError && <p className="profile-error">{passwordError}</p>}
            <div className="profile-modal-actions">
              <button onClick={() => setShowPasswordModal(false)}>Cancel</button>
              <button onClick={handlePasswordChange} disabled={passwordSaving}>
                {passwordSaving ? 'Saving…' : 'Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
