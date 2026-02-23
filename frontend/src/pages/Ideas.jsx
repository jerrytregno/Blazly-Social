import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import './Planner.css';

export default function Ideas() {
  const navigate = useNavigate();
  const [ideas, setIdeas] = useState([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasCategory, setIdeasCategory] = useState('social');

  const loadIdeas = useCallback(async () => {
    setIdeasLoading(true);
    try {
      const res = await api(`/trends/ideas?category=${ideasCategory}`);
      const data = await res.json();
      if (res.ok) setIdeas(data.ideas || []);
      else setIdeas([]);
    } catch (_) { setIdeas([]); }
    setIdeasLoading(false);
  }, [ideasCategory]);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  const handleUseIdea = (postIdea) => {
    navigate('/planner', { state: { openSchedule: true, scheduleContent: postIdea || '' } });
  };

  return (
    <div className="planner-page">
      <header className="planner-header">
        <div className="planner-header-top">
          <button className="planner-back" onClick={() => navigate('/home')}>← Back</button>
        </div>
        <h1>Content Ideas</h1>
        <p className="planner-desc">
          AI-suggested post ideas based on your keywords and current trends. Refresh to get new ideas as trends change.
        </p>
      </header>

      <div className="planner-ideas-view">
        <div className="planner-ideas-toolbar">
          <select value={ideasCategory} onChange={(e) => setIdeasCategory(e.target.value)} className="planner-ideas-select">
            <option value="social">Social & Content</option>
            <option value="business">Business</option>
            <option value="tech">Tech</option>
          </select>
          <button className="planner-ideas-refresh" onClick={loadIdeas} disabled={ideasLoading}>
            {ideasLoading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
        {ideasLoading && ideas.length === 0 ? (
          <div className="planner-ideas-loading"><LoadingScreen compact /></div>
        ) : ideas.length === 0 ? (
          <p className="planner-ideas-empty">No ideas yet. Add keywords in Profile to get personalized suggestions.</p>
        ) : (
          <div className="planner-ideas-list">
            {ideas.map((idea, idx) => (
              <div key={idx} className="planner-idea-card">
                <span className="planner-idea-platform">{idea.platform || 'social'}</span>
                <h4>{idea.title || 'Post idea'}</h4>
                <p className="planner-idea-body">{idea.postIdea}</p>
                {idea.trend && <span className="planner-idea-trend">Trend: {idea.trend}</span>}
                <button type="button" className="planner-idea-use" onClick={() => handleUseIdea(idea.postIdea)}>Use this idea</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
