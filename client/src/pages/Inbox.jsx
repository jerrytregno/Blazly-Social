import { useState, useEffect, useCallback } from 'react';
import { useAuth, api } from '../hooks/useAuth';
import './Inbox.css';

export default function Inbox() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/inbox');
      const data = await res.json();
      setItems(data.items || []);
    } catch (_) { setItems([]); }
    setLoading(false);
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api('/inbox/settings');
        const data = await res.json();
        setAutoReplyEnabled(data.autoReplyEnabled === true);
      } catch (_) {}
      setSettingsLoading(false);
    })();
  }, []);

  const filteredItems = platformFilter === 'all'
    ? items
    : items.filter((i) => i.platform === platformFilter);

  const handleAiSuggest = async () => {
    if (!selectedItem) return;
    setAiLoading(true);
    try {
      const res = await api('/inbox/ai-reply', {
        method: 'POST',
        body: JSON.stringify({
          commentText: selectedItem.text,
          platform: selectedItem.platform,
        }),
      });
      const data = await res.json();
      if (data.reply) setReplyText(data.reply);
    } catch (_) {}
    setAiLoading(false);
  };

  const handleSendReply = async () => {
    if (!selectedItem || !replyText.trim()) return;
    setReplyLoading(true);
    try {
      const payload = {
        commentId: selectedItem.id,
        platform: selectedItem.platform,
        replyText: replyText.trim(),
      };
      if (selectedItem.platform === 'linkedin' && (selectedItem.postUrn || selectedItem.postId)) {
        payload.postUrn = selectedItem.postUrn || selectedItem.postId;
        payload.parentCommentUrn = selectedItem.id?.startsWith?.('urn:li:comment') ? selectedItem.id : undefined;
      }
      const res = await api('/inbox/reply', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setReplyText('');
        setSelectedItem(null);
        loadInbox();
      } else {
        alert(data.error || 'Failed to send reply');
      }
    } catch (e) {
      alert('Failed to send reply');
    }
    setReplyLoading(false);
  };

  const toggleAutoReply = async () => {
    const next = !autoReplyEnabled;
    try {
      const res = await api('/inbox/settings', {
        method: 'PATCH',
        body: JSON.stringify({ autoReplyEnabled: next }),
      });
      if (res.ok) setAutoReplyEnabled(next);
    } catch (_) {}
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const platforms = [...new Set(items.map((i) => i.platform))];

  return (
    <div className="inbox-page">
      <header className="inbox-header">
        <h1>OmniInbox</h1>
        <p className="inbox-desc">
          Unified AI comment & message manager. Available for Instagram and Facebook business pages. Threads, LinkedIn, and Twitter support coming soon.
        </p>

        <div className="inbox-toolbar">
          <select
            className="inbox-filter"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
          >
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
          <label className="inbox-autoreply">
            <input
              type="checkbox"
              checked={autoReplyEnabled}
              onChange={toggleAutoReply}
              disabled={settingsLoading}
            />
            Auto-reply AI (optional)
          </label>
          <button className="inbox-refresh" onClick={loadInbox} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="inbox-content">
        <aside className="inbox-list">
          {loading ? (
            <div className="inbox-loading">Loading comments...</div>
          ) : filteredItems.length === 0 ? (
            <div className="inbox-empty">
              No comments yet. Connect Instagram or Facebook in Integrations to see comments here.
            </div>
          ) : (
            <ul className="inbox-items">
              {filteredItems.map((item) => (
                <li
                  key={`${item.platform}-${item.id}`}
                  className={`inbox-item ${selectedItem?.id === item.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedItem(item);
                    setReplyText('');
                  }}
                >
                  <span className="inbox-item__badge">{item.platform}</span>
                  <span className="inbox-item__author">{item.author}</span>
                  <span className="inbox-item__text">{item.text}</span>
                  <span className="inbox-item__time">{formatTime(item.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="inbox-detail">
          {!selectedItem ? (
            <div className="inbox-detail-placeholder">
              Select a comment to view and reply
            </div>
          ) : (
            <div className="inbox-detail-card">
              <div className="inbox-detail-meta">
                <span className="inbox-detail-badge">{selectedItem.platform}</span>
                {selectedItem.accountName && (
                  <span className="inbox-detail-account">{selectedItem.accountName}</span>
                )}
              </div>
              <div className="inbox-detail-author">{selectedItem.author}</div>
              <p className="inbox-detail-text">{selectedItem.text}</p>
              {selectedItem.postPreview && (
                <p className="inbox-detail-post">Post: {selectedItem.postPreview}...</p>
              )}
              {selectedItem.permalink && (
                <a href={selectedItem.permalink} target="_blank" rel="noopener noreferrer" className="inbox-detail-link">
                  View on {selectedItem.platform}
                </a>
              )}

              <div className="inbox-reply">
                <textarea
                  className="inbox-reply-input"
                  placeholder="Type your reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                />
                <div className="inbox-reply-actions">
                  <button
                    className="inbox-ai-suggest"
                    onClick={handleAiSuggest}
                    disabled={aiLoading}
                  >
                    {aiLoading ? 'Generating...' : 'AI Suggest'}
                  </button>
                  <button
                    className="inbox-send"
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || replyLoading}
                  >
                    {replyLoading ? 'Sending...' : 'Send reply'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
