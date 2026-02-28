import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import PlatformLogo from '../components/PlatformLogo';
import './Planner.css';
import './Ideas.css';

const PLATFORM_LABELS = { twitter: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads' };
const CONTENT_TYPE_LABELS = { text: 'Text post', reel: 'Reel', image: 'Image/Carousel' };

export default function Ideas() {
  const navigate = useNavigate();
  const [ideas, setIdeas] = useState([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [ideasCategory, setIdeasCategory] = useState('social');
  const [customInstruction, setCustomInstruction] = useState('');
  const [includeImageToggle, setIncludeImageToggle] = useState(true);
  const [useIdeaModal, setUseIdeaModal] = useState(null); // { idea, platform }

  const loadIdeas = useCallback(async () => {
    setIdeasLoading(true);
    try {
      const res = await api(`/trends/ideas?category=${ideasCategory}`);
      const data = await res.json();
      if (res.ok && data.ideas?.length) {
        setIdeas(data.ideas);
      } else {
        setIdeas([]);
      }
    } catch (_) {
      setIdeas([]);
    }
    setIdeasLoading(false);
  }, [ideasCategory]);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  const handleGenerate = async () => {
    setGenerateLoading(true);
    try {
      const res = await api('/trends/ideas/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: ideasCategory,
          customInstruction: customInstruction.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ideas?.length) {
        setIdeas(data.ideas);
      } else {
        setIdeas([]);
      }
    } catch (_) {
      setIdeas([]);
    }
    setGenerateLoading(false);
  };

  const handleImplementIdea = (idea) => {
    if (idea.contentType === 'reel') {
      navigate(`/home?platform=instagram`, {
        state: { ideaPrompt: idea.postIdea, contentType: 'reel', platform: 'instagram' },
      });
      return;
    }
    if (idea.contentType === 'image' && idea.platform === 'instagram') {
      navigate(`/home?platform=instagram`, {
        state: { ideaPrompt: idea.postIdea, contentType: 'image', platform: 'instagram' },
      });
      return;
    }
    setUseIdeaModal({ idea, platform: idea.platform });
  };

  const handleSendNow = () => {
    if (!useIdeaModal) return;
    const { idea, platform } = useIdeaModal;
    navigate(`/home?platform=${platform}`, {
      state: {
        ideaPrompt: idea.postIdea,
        sendNow: true,
        includeImage: includeImageToggle,
      },
    });
    setUseIdeaModal(null);
  };

  const handleScheduleForLater = () => {
    if (!useIdeaModal) return;
    const { idea, platform } = useIdeaModal;
    navigate(`/home?platform=${platform}`, {
      state: {
        ideaPrompt: idea.postIdea,
        sendNow: false,
        includeImage: includeImageToggle,
      },
    });
    setUseIdeaModal(null);
  };

  const isReelOrVideoOnly = (idea) =>
    idea.contentType === 'reel' || (idea.platform === 'instagram' && idea.contentType === 'reel');

  return (
    <div className="planner-page">
      <header className="planner-header">
        <div className="planner-header-top">
          <button className="planner-back" onClick={() => navigate('/home')}>← Back</button>
        </div>
        <h1>Content Ideas</h1>
        <p className="planner-desc">
          Generate AI-suggested post ideas based on your keywords and custom instructions. Ideas are cached until you generate new ones.
        </p>
      </header>

      <div className="planner-ideas-view">
        <div className="planner-ideas-toolbar">
          <select
            value={ideasCategory}
            onChange={(e) => setIdeasCategory(e.target.value)}
            className="planner-ideas-select"
          >
            <option value="social">Social & Content</option>
            <option value="business">Business</option>
            <option value="tech">Tech</option>
          </select>
          <div className="ideas-custom-row">
            <input
              type="text"
              className="ideas-custom-input"
              placeholder="Custom instruction (optional)"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
            />
            <label className="ideas-toggle-switch">
              <input
                type="checkbox"
                checked={includeImageToggle}
                onChange={(e) => setIncludeImageToggle(e.target.checked)}
              />
              <span className="ideas-toggle-slider" />
              <span>Include image</span>
            </label>
          </div>
          <button
            className="planner-ideas-refresh"
            onClick={handleGenerate}
            disabled={generateLoading}
          >
            {generateLoading ? 'Generating…' : 'Generate Ideas'}
          </button>
        </div>

        {ideasLoading && ideas.length === 0 ? (
          <div className="planner-ideas-loading"><LoadingScreen compact /></div>
        ) : ideas.length === 0 ? (
          <div className="planner-ideas-empty-state">
            <p>No ideas yet. Click &quot;Generate Ideas&quot; to create personalized suggestions.</p>
            <p className="ideas-hint">Add keywords in Profile and use custom instructions for better results.</p>
          </div>
        ) : (
          <div className="planner-ideas-list">
            {ideas.map((idea, idx) => (
              <div key={idx} className="planner-idea-card">
                <div className="planner-idea-meta">
                  <span className="planner-idea-platform">
                    <PlatformLogo platform={idea.platform} size={16} />
                    {PLATFORM_LABELS[idea.platform] || idea.platform}
                  </span>
                  {idea.contentType && (
                    <span className="planner-idea-content-type">
                      {CONTENT_TYPE_LABELS[idea.contentType] || idea.contentType}
                    </span>
                  )}
                </div>
                <h4>{idea.title || 'Post idea'}</h4>
                <p className="planner-idea-body">{idea.postIdea}</p>
                {idea.trend && <span className="planner-idea-trend">Trend: {idea.trend}</span>}
                {isReelOrVideoOnly(idea) ? (
                  <button
                    type="button"
                    className="planner-idea-implement"
                    onClick={() => handleImplementIdea(idea)}
                  >
                    Implement idea →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="planner-idea-use"
                    onClick={() => handleImplementIdea(idea)}
                  >
                    Use this idea
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {useIdeaModal && (
        <div className="planner-modal-overlay" onClick={() => setUseIdeaModal(null)}>
          <div className="planner-modal ideas-use-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Use idea: {useIdeaModal.idea.title}</h3>
            <p className="ideas-modal-prompt">{useIdeaModal.idea.postIdea}</p>
            <label className="ideas-modal-toggle ideas-toggle-switch">
              <input
                type="checkbox"
                checked={includeImageToggle}
                onChange={(e) => setIncludeImageToggle(e.target.checked)}
              />
              <span className="ideas-toggle-slider" />
              <span>Generate image with AI</span>
            </label>
            <div className="planner-modal-actions">
              <button className="planner-modal-cancel" onClick={() => setUseIdeaModal(null)}>Cancel</button>
              <button className="planner-modal-submit" onClick={handleScheduleForLater}>
                Schedule for later
              </button>
              <button className="planner-modal-submit planner-modal-submit--primary" onClick={handleSendNow}>
                Send now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
