import { useState, useEffect, useCallback } from 'react';
import { api } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import PlatformLogo from '../components/PlatformLogo';
import './KeywordAlerts.css';

const PLATFORM_LABELS = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
};

const ALL_PLATFORMS = ['twitter', 'linkedin'];

export default function KeywordAlerts() {
  const [config, setConfig] = useState({
    keywords: [],
    platforms: ['twitter'],
    enabled: true,
    lastPolledAt: null,
  });
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [runResult, setRunResult] = useState(null);

  const loadConfig = async () => {
    try {
      const r = await api('/keyword-poll');
      const data = await r.json();
      const platforms = data.platforms?.length ? data.platforms : ['twitter'];
      setConfig({ ...data, platforms });
      return { ...data, platforms };
    } catch (_) {
      setConfig({
        keywords: [],
        platforms: ['twitter'],
        enabled: true,
        lastPolledAt: null,
      });
      return { platforms: ['twitter'] };
    }
  };

  const loadMatches = useCallback(async (platformsOverride) => {
    try {
      const platforms = platformsOverride ?? config.platforms ?? ['twitter'];
      const params = platforms?.length ? `?platforms=${platforms.join(',')}` : '';
      const r = await api(`/keyword-poll/matches${params}`);
      const data = await r.json();
      setMatches(data.matches || []);
    } catch (_) {
      setMatches([]);
    }
  }, [config.platforms]);

  useEffect(() => {
    setLoading(true);
    loadConfig()
      .then(() => {})
      .finally(() => setLoading(false));
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

  const handleSave = async (next) => {
    setSaving(true);
    try {
      await api('/keyword-poll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      setConfig(next);
    } catch (_) {}
    setSaving(false);
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
      const r = await api('/keyword-poll/run', { method: 'POST' });
      const data = await r.json();
      setRunResult(data);
      const cfg = await loadConfig();
      await loadMatches(cfg?.platforms);
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

  const selectedPlatforms = config.platforms || ['twitter'];
  const canUnselectTwitter = selectedPlatforms.length > 1;

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
