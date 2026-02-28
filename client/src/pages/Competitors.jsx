import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import './Competitors.css';

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

const SOCIAL_PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/...' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/...' },
  { id: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/...' },
  { id: 'twitter', label: 'X (Twitter)', placeholder: 'https://x.com/...' },
];

export default function Competitors() {
  const navigate = useNavigate();
  const [competitors, setCompetitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [socialLinks, setSocialLinks] = useState({ linkedin: '', instagram: '', facebook: '', twitter: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api('/profile/competitors');
        if (res.ok) {
          const data = await res.json();
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
        setCompetitors((prev) => [data.competitor, ...prev]);
        setAddModal(false);
        setCompetitorName('');
        setCompetitorUrl('');
        setSocialLinks({ linkedin: '', instagram: '', facebook: '', twitter: '' });
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
                  <div className="competitors-activity-report">
                    <h4>Social Activity Report</h4>
                    <p className="competitors-activity-summary">{comp.socialActivityReport.summary}</p>
                    <div className="competitors-activity-meta">
                      <span>Post frequency: {comp.socialActivityReport.postFrequency}</span>
                      <span>Engagement: {comp.socialActivityReport.engagementLevel}</span>
                    </div>
                  </div>
                )}
                {comp.lastScrapedAt && (
                  <span className="competitors-scraped">
                    Last analyzed: {new Date(comp.lastScrapedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              <div className="competitors-sections">
                {SECTIONS.map(({ key, label }) => {
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
