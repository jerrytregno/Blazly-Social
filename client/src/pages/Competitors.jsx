import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { api } from '../hooks/useAuth';
import { getCompetitors, saveCompetitor } from '../services/firestore';
import LoadingScreen from '../components/LoadingScreen';
import './Competitors.css';

const PLATFORM_ICONS = { linkedin: '💼', instagram: '📸', facebook: '📘', twitter: '🐦', threads: '🧵' };

function engagementClass(level = '') {
  const l = level.toLowerCase();
  if (l.includes('high')) return 'high';
  if (l.includes('medium') || l.includes('moderate')) return 'medium';
  if (l.includes('low')) return 'low';
  return '';
}

function SocialActivityReport({ report }) {
  if (!report) return null;
  const {
    summary, postFrequency, engagementLevel, audienceInsights,
    contentThemes = [], bestPostingTimes = [], platformBreakdown = {},
    ideaGenerationHints = [], competitorStrengths = [], competitorWeaknesses = [],
    recommendedActions = [],
  } = report;

  const activePlatforms = Object.entries(platformBreakdown).filter(
    ([, d]) => d && d.activityLevel && d.activityLevel !== 'No data' && d.activityLevel !== ''
  );

  return (
    <div className="competitors-activity-report">
      <h4 className="competitors-activity-report-title">📊 Social Media Report</h4>
      {summary && <p className="competitors-activity-summary">{summary}</p>}

      <div className="competitors-activity-meta">
        {postFrequency && postFrequency !== 'Unknown' && (
          <span className="competitors-activity-badge">🗓 {postFrequency}</span>
        )}
        {engagementLevel && engagementLevel !== 'Unknown' && (
          <span className={`competitors-activity-badge ${engagementClass(engagementLevel)}`}>
            📈 Engagement: {engagementLevel}
          </span>
        )}
      </div>

      {activePlatforms.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Platform Breakdown</p>
          <div className="competitors-platform-grid">
            {activePlatforms.map(([platform, data]) => (
              <div key={platform} className="competitors-platform-card">
                <div className="competitors-platform-card-name">
                  {PLATFORM_ICONS[platform] || '🔗'} {platform}
                </div>
                {data.followers > 0 && (
                  <div className="competitors-platform-metric">
                    <span>Followers</span>
                    <span>{Number(data.followers).toLocaleString()}</span>
                  </div>
                )}
                {data.postsCount > 0 && (
                  <div className="competitors-platform-metric">
                    <span>Posts</span>
                    <span>{Number(data.postsCount).toLocaleString()}</span>
                  </div>
                )}
                {data.estimatedEngagementRate && data.estimatedEngagementRate !== 'Unknown' && (
                  <div className="competitors-platform-metric">
                    <span>Eng. Rate</span>
                    <span>{data.estimatedEngagementRate}</span>
                  </div>
                )}
                {data.activityLevel && (
                  <div className="competitors-platform-metric">
                    <span>Activity</span>
                    <span>{data.activityLevel}</span>
                  </div>
                )}
                {data.contentStyle && (
                  <div className="competitors-platform-style">{data.contentStyle}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {contentThemes.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Content Themes</p>
          <div className="competitors-themes">
            {contentThemes.map((t, i) => (
              <span key={i} className="competitors-theme-tag">{t}</span>
            ))}
          </div>
        </>
      )}

      {audienceInsights && (
        <>
          <p className="competitors-activity-section-label">Audience Insights</p>
          <p className="competitors-activity-summary" style={{ marginBottom: 0 }}>{audienceInsights}</p>
        </>
      )}

      {bestPostingTimes.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Best Posting Times</p>
          <ul className="competitors-insights-list">
            {bestPostingTimes.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
      )}

      {competitorStrengths.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Their Strengths</p>
          <ul className="competitors-insights-list">
            {competitorStrengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </>
      )}

      {competitorWeaknesses.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Their Weaknesses / Gaps</p>
          <ul className="competitors-insights-list">
            {competitorWeaknesses.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </>
      )}

      {ideaGenerationHints.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Content Ideas to Outperform Them</p>
          <ul className="competitors-insights-list">
            {ideaGenerationHints.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </>
      )}

      {recommendedActions.length > 0 && (
        <>
          <p className="competitors-activity-section-label">Recommended Actions</p>
          <ul className="competitors-insights-list">
            {recommendedActions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

const SECTIONS = [
  { key: 'ideology', label: 'What They Do' },
  { key: 'positioning', label: 'What Makes Them Different' },
  { key: 'sustainabilityModel', label: 'Sustainability Strategy' },
  { key: 'messagingTone', label: 'Messaging Strategy' },
  { key: 'contentStyle', label: 'Content Style' },
  { key: 'keyProducts', label: 'Key Products' },
  { key: 'pricingStrategy', label: 'Pricing Strategy' },
  { key: 'targetAudience', label: 'Target Audience' },
  { key: 'socialProof', label: 'Social Proof' },
  { key: 'strengthsVsYou', label: 'Strength vs You' },
  { key: 'opportunityGap', label: 'Opportunity Gap' },
];

const US_VS_THEM_KEYS = ['strengthsVsYou', 'opportunityGap'];

const SOCIAL_PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/...' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/...' },
  { id: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/...' },
  { id: 'twitter', label: 'X (Twitter)', placeholder: 'https://x.com/...' },
  { id: 'threads', label: 'Threads', placeholder: 'https://threads.net/...' },
];

export default function Competitors() {
  const navigate = useNavigate();
  const [competitors, setCompetitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [socialLinks, setSocialLinks] = useState({ linkedin: '', instagram: '', facebook: '', twitter: '', threads: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api('/profile/competitors');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setCompetitors(data);
            setLoading(false);
            return;
          }
        }
      } catch (_) {}
      // Fallback: load from client Firestore
      try {
        const uid = auth.currentUser?.uid;
        if (uid) {
          const data = await getCompetitors(uid);
          setCompetitors(Array.isArray(data) ? data : []);
        }
      } catch (_) {}
      setLoading(false);
    };
    load();
  }, []);

  const handleAdd = async () => {
    if (!competitorName.trim() || !competitorUrl.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const links = Object.fromEntries(
        Object.entries(socialLinks).filter(([, v]) => v && v.trim())
      );
      const res = await api('/profile/competitors', {
        method: 'POST',
        body: JSON.stringify({
          competitorName: competitorName.trim(),
          competitorUrl: competitorUrl.trim(),
          socialLinks: Object.keys(links).length ? links : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        let comp = data.competitor;
        // Always persist to client Firestore as source of truth (server may not have credentials)
        try {
          const uid = auth.currentUser?.uid;
          if (uid) comp = await saveCompetitor(uid, comp);
        } catch (saveErr) {
          console.warn('Client Firestore save failed:', saveErr.message);
        }
        setCompetitors((prev) => [comp, ...prev]);
        setAddModal(false);
        setCompetitorName('');
        setCompetitorUrl('');
        setSocialLinks({ linkedin: '', instagram: '', facebook: '', twitter: '', threads: '' });
      } else {
        setAddError(data.error || 'Failed to add competitor');
      }
    } catch (e) {
      setAddError(e.message || 'Failed');
    }
    setAdding(false);
  };

  if (loading) return <div className="competitors-loading"><LoadingScreen /></div>;

  return (
    <div className="competitors-page">
      <header className="competitors-header">
        <button className="competitors-back" onClick={() => navigate('/profile')}>← Back</button>
        <h1>Competitor Analysis</h1>
        <p className="competitors-desc">AI-powered insights from competitor websites</p>
        <button className="competitors-add" onClick={() => setAddModal(true)}>+ Add Competitor</button>
      </header>

      {competitors.length === 0 ? (
        <div className="competitors-empty">
          <p>No competitors added yet.</p>
          <button className="competitors-add-btn" onClick={() => setAddModal(true)}>Add your first competitor</button>
        </div>
      ) : (
        <div className="competitors-list">
          {competitors.map((comp) => (
            <div key={comp.id} className="competitors-card">
              <div className="competitors-card-header">
                <h2>{comp.competitorName}</h2>
                <a href={comp.competitorUrl} target="_blank" rel="noopener noreferrer" className="competitors-link">
                  {comp.competitorUrl}
                </a>
                {comp.socialLinks && Object.keys(comp.socialLinks).length > 0 && (
                  <div className="competitors-social-links">
                    {Object.entries(comp.socialLinks).map(([platform, url]) => (
                      <a key={platform} href={url} target="_blank" rel="noopener noreferrer" className="competitors-social-link">
                        {platform}
                      </a>
                    ))}
                  </div>
                )}
                {comp.socialActivityReport && (
                  <SocialActivityReport report={comp.socialActivityReport} />
                )}
                {comp.lastScrapedAt && (
                  <span className="competitors-scraped">
                    Last analyzed: {new Date(comp.lastScrapedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {US_VS_THEM_KEYS.some((k) => comp.aiAnalysis?.[k]) && (
                <div className="competitors-us-vs-them">
                  <h3 className="competitors-us-vs-them-title">Us vs Them — Key Differences</h3>
                  {US_VS_THEM_KEYS.map((key) => {
                    const val = comp.aiAnalysis?.[key];
                    if (!val) return null;
                    const label = SECTIONS.find((s) => s.key === key)?.label || key;
                    return (
                      <div key={key} className="competitors-us-vs-them-item">
                        <h4>{label}</h4>
                        <p>{typeof val === 'string' ? val : JSON.stringify(val)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="competitors-sections">
                {SECTIONS.filter((s) => !US_VS_THEM_KEYS.includes(s.key)).map(({ key, label }) => {
                  const val = comp.aiAnalysis?.[key];
                  if (!val) return null;
                  const isArray = Array.isArray(val);
                  return (
                    <div key={key} className="competitors-section">
                      <h3 className="competitors-section-title">{label}</h3>
                      <div className="competitors-section-content">
                        {isArray ? (
                          <ul>
                            {val.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>{val}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {addModal && (
        <div className="competitors-modal-overlay" onClick={() => !adding && setAddModal(false)}>
          <div className="competitors-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Competitor</h3>
            <div className="competitors-modal-field">
              <label>Name</label>
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="Competitor Inc"
              />
            </div>
            <div className="competitors-modal-field">
              <label>Website URL</label>
              <input
                type="url"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
                placeholder="https://competitor.com"
              />
            </div>
            <div className="competitors-modal-field">
              <label>Social media links (optional)</label>
              {SOCIAL_PLATFORMS.map((p) => (
                <input
                  key={p.id}
                  type="url"
                  value={socialLinks[p.id] || ''}
                  onChange={(e) => setSocialLinks((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={p.placeholder}
                  className="competitors-modal-social-input"
                />
              ))}
            </div>
            {addError && <p className="competitors-error">{addError}</p>}
            <div className="competitors-modal-actions">
              <button onClick={() => setAddModal(false)}>Cancel</button>
              <button
                className="competitors-modal-submit"
                onClick={handleAdd}
                disabled={adding || !competitorName.trim() || !competitorUrl.trim()}
              >
                {adding ? 'Analyzing…' : 'Add & Analyze'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
