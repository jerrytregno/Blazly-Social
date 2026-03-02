import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../firebase';
import { api } from '../hooks/useAuth';
import { getIntegrations, getUserProfile } from '../services/firestore';
import LoadingScreen from '../components/LoadingScreen';
import PlatformLogo from '../components/PlatformLogo';
import './KeywordAlerts.css';

const PLATFORM_LABELS = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

// Threads has no public search API — excluded from keyword monitoring
const ALL_PLATFORMS = ['twitter', 'linkedin', 'instagram', 'facebook'];

export default function KeywordAlerts() {
  const [config, setConfig] = useState({
    keywords: [],
    platforms: ['twitter', 'linkedin'],
    enabled: true,
    lastPolledAt: null,
  });
  const [integrations, setIntegrations] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [runResult, setRunResult] = useState(null);
  const saveTimeoutRef = useRef(null);

  const loadConfig = async (profileKeywords = []) => {
    try {
      const r = await api('/keyword-poll');
      const data = await r.json();
      const platforms = data.platforms?.length ? data.platforms : ['twitter', 'linkedin'];
      // Merge profile keywords if not already in config
      let keywords = data.keywords || [];
      if (profileKeywords.length && keywords.length === 0) {
        keywords = profileKeywords;
      }
      const merged = { ...data, platforms, keywords };
      setConfig(merged);
      return merged;
    } catch (_) {
      const fallback = {
        keywords: profileKeywords,
        platforms: ['twitter', 'linkedin'],
        enabled: true,
        lastPolledAt: null,
      };
      setConfig(fallback);
      return fallback;
    }
  };

  // Load matches from server (may be empty with credential errors - matches persist in local state)
  const loadMatches = useCallback(async (platformsOverride) => {
    try {
      const platforms = platformsOverride ?? config.platforms ?? ['twitter'];
      const params = platforms?.length ? `?platforms=${platforms.join(',')}` : '';
      const r = await api(`/keyword-poll/matches${params}`);
      const data = await r.json();
      // Only update if server returned actual matches (don't wipe existing local matches)
      if (Array.isArray(data.matches) && data.matches.length > 0) {
        setMatches(data.matches);
      }
    } catch (_) {}
  }, [config.platforms]);

  useEffect(() => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    Promise.allSettled([
      uid ? getIntegrations(uid) : Promise.resolve([]),
      uid ? getUserProfile(uid) : Promise.resolve(null),
    ]).then(([intResult, profileResult]) => {
      if (intResult.status === 'fulfilled') setIntegrations(intResult.value || []);
      const profileKeywords = profileResult.status === 'fulfilled'
        ? (profileResult.value?.keywords || [])
        : [];
      return loadConfig(profileKeywords);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    loadMatches();
  }, [loading, loadMatches]);

  const handleAddKeyword = () => {
    const k = newKeyword.trim();
    if (!k || config.keywords.includes(k)) return;
    setNewKeyword('');
    handleSave({ ...config, keywords: [...config.keywords, k] });
  };

  const handleRemoveKeyword = (k) => {
    handleSave({ ...config, keywords: config.keywords.filter((x) => x !== k) });
  };

  const handleSave = (next) => {
    setConfig(next);
    // Debounce: save to server 600ms after last change
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaving(true);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await api('/keyword-poll', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
      } catch (_) {}
      setSaving(false);
    }, 600);
  };

  const togglePlatform = (p) => {
    const current = config.platforms || ['twitter'];
    if (current.includes(p)) {
      if (current.length <= 1) return;
      const next = current.filter((x) => x !== p);
      handleSave({ ...config, platforms: next.length ? next : ['twitter'] });
    } else {
      handleSave({ ...config, platforms: [...current, p] });
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const r = await api('/keyword-poll/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: config.keywords,
          platforms: config.platforms,
          integrations,
        }),
      });
      const data = await r.json();
      setRunResult(data);
      // Merge server-returned matches with existing matches (for client-mode - never overwrites)
      if (Array.isArray(data.matches) && data.matches.length > 0) {
        setMatches((prev) => {
          const existingIds = new Set(prev.map((m) => m.postId || m._id));
          const newOnes = data.matches.filter((m) => !existingIds.has(m.postId));
          return [...newOnes.map((m) => ({
            ...m,
            _id: m.postId || m._id,
            read: false,
            createdAt: new Date().toISOString(),
          })), ...prev];
        });
      }
      // Only call loadMatches if there's a chance server has real data
      await loadMatches(config.platforms);
    } catch (_) {
      setRunResult({ matched: 0, message: 'Failed to run' });
    }
    setRunning(false);
  };

  const markRead = async (id) => {
    try {
      await api(`/keyword-poll/matches/${id}/read`, { method: 'PATCH' });
      setMatches((prev) => prev.map((m) => (m._id === id ? { ...m, read: true } : m)));
    } catch (_) {}
  };

  const selectedPlatforms = (config.platforms || ['twitter']).filter((p) => p !== 'threads');
  const canUnselectTwitter = selectedPlatforms.length > 1;

  // Detect when Instagram is selected but user only has a direct-login token (no Facebook Business)
  const igIntegration = integrations.find((i) => i.platform === 'instagram');
  const igIsDirectLogin = igIntegration && !igIntegration.instagramBusinessAccountId;
  const showIgWarning = selectedPlatforms.includes('instagram') && igIsDirectLogin;

  // Detect when Facebook is selected but no page is connected
  const fbIntegration = integrations.find((i) => i.platform === 'facebook');
  const showFbWarning = selectedPlatforms.includes('facebook') && fbIntegration && !fbIntegration.facebookPageId;

  if (loading) {
    return (
      <div className="keyword-alerts-loading">
        <LoadingScreen compact />
      </div>
    );
  }

  return (
    <div className="keyword-alerts-page">
      <header className="keyword-alerts-header">
        <h1>Keyword Alerts</h1>
        <p className="keyword-alerts-desc">
          Monitor keywords across platforms. When a post mentions your keyword, you will see it here.
        </p>
      </header>

      <section className="keyword-alerts-config">
        <h2>Keywords to monitor</h2>
        <div className="keyword-alerts-input-row">
          <input
            type="text"
            placeholder="Add keyword (e.g. product name)"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
          />
          <button onClick={handleAddKeyword} disabled={saving}>
            Add
          </button>
        </div>
        <div className="keyword-alerts-tags">
          {config.keywords.map((k) => (
            <span key={k} className="keyword-alerts-tag">
              {k}
              <button onClick={() => handleRemoveKeyword(k)} aria-label="Remove">×</button>
            </span>
          ))}
          {config.keywords.length === 0 && (
            <span className="keyword-alerts-empty">No keywords yet. Add product or brand names to monitor.</span>
          )}
        </div>

        <div className="keyword-alerts-platforms-row">
          <span className="keyword-alerts-platforms-label">Platforms</span>
          <div className="keyword-alerts-platform-chips">
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={`keyword-alerts-platform-chip ${selectedPlatforms.includes(p) ? 'selected' : ''}`}
                onClick={() => togglePlatform(p)}
                disabled={p === 'twitter' && !canUnselectTwitter}
                title={p === 'twitter' && !canUnselectTwitter ? 'At least one platform required' : ''}
              >
                <PlatformLogo platform={p} size={16} />
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {showIgWarning && (
          <div className="keyword-alerts-platform-notice keyword-alerts-notice--warn">
            <strong>Instagram:</strong> Hashtag search requires a Facebook Business account connection.
            Your Instagram is connected via direct login, which does not support public hashtag search.
            To enable: go to <strong>Integrations → Facebook</strong> and connect a Page that has an
            Instagram Business account linked to it.
          </div>
        )}
        {showFbWarning && (
          <div className="keyword-alerts-platform-notice keyword-alerts-notice--warn">
            <strong>Facebook:</strong> No Facebook Page is connected. Keyword search scans your
            page&apos;s feed for mentions. Connect a Facebook Page in <strong>Integrations</strong>.
          </div>
        )}

        <div className="keyword-alerts-actions">
          <label className="keyword-alerts-toggle keyword-alerts-toggle-switch">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleSave({ ...config, enabled: e.target.checked })}
            />
            <span className="keyword-alerts-toggle-slider" />
            <span className="keyword-alerts-toggle-label">Enable hourly polling</span>
          </label>
          <button className="keyword-alerts-run" onClick={handleRun} disabled={running}>
            {running ? 'Polling…' : 'Poll now'}
          </button>
          {config.lastPolledAt && (
            <span className="keyword-alerts-last">
              Last polled: {new Date(config.lastPolledAt).toLocaleString()}
            </span>
          )}
        </div>
        {runResult && (
          <p className="keyword-alerts-result">
            {runResult.matched > 0
              ? `Found ${runResult.matched} new match(es).`
              : runResult.message || 'No new matches.'}
          </p>
        )}
      </section>

      <section className="keyword-alerts-matches">
        <h2>Recent matches</h2>
        {matches.length === 0 ? (
          <div className="keyword-alerts-matches-empty">
            <p>No matches yet.</p>
            <p>
              Add keywords and click Poll now. Connect platforms in Integrations: X (tweets), LinkedIn (ads).
            </p>
          </div>
        ) : (
          <ul className="keyword-alerts-list">
            {matches.map((m) => (
              <li
                key={m._id}
                className={`keyword-alerts-match ${m.read ? 'read' : ''}`}
                onClick={() => !m.read && markRead(m._id)}
              >
                <div className="keyword-alerts-match-header">
                  <PlatformLogo platform={m.platform} size={18} />
                  <span className="keyword-alerts-match-platform">{PLATFORM_LABELS[m.platform] || m.platform}</span>
                  <span className="keyword-alerts-match-keyword">#{m.keyword}</span>
                  {m.authorUsername && (
                    <span className="keyword-alerts-match-author">@{m.authorUsername}</span>
                  )}
                </div>
                {m.postText && <p className="keyword-alerts-match-text">{m.postText}</p>}
                {m.postUrl && (
                  <a href={m.postUrl} target="_blank" rel="noopener noreferrer" className="keyword-alerts-match-link">
                    View post →
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
