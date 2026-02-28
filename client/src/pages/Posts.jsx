import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, api } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import PlatformLogo from '../components/PlatformLogo';
import './Posts.css';

const PLATFORM_LABELS = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
};

function PostAnalyticsBlock({ post, onRefresh }) {
  const [analytics, setAnalytics] = useState(post.analytics ? (post.analytics instanceof Map ? Object.fromEntries(post.analytics) : post.analytics) : null);
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await api(`/posts/${post.id}/analytics`, { method: 'POST' });
      const data = await res.json();
      if (data.analytics) setAnalytics(data.analytics);
      onRefresh?.();
    } catch (_) {}
    setLoading(false);
  };

  const hasAnalytics = analytics && Object.keys(analytics).length > 0;
  const hasPlatformIds = post.platformIds && (Object.keys(post.platformIds).length > 0);

  if (!hasAnalytics && !hasPlatformIds) return null;

  return (
    <div className="posts-modal__analytics">
      <div className="posts-modal__analytics-header">
        <h4>Analytics</h4>
        {hasPlatformIds && (
          <button className="posts-modal__analytics-refresh" onClick={handleRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      {hasAnalytics ? (
        <div className="posts-modal__analytics-grid">
          {Object.entries(analytics).map(([platform, m]) => (
            <div key={platform} className="posts-modal__analytics-platform">
              <span className="posts-modal__analytics-platform-name">{PLATFORM_LABELS[platform] || platform}</span>
              <div className="posts-modal__analytics-metrics">
                {m.impressions != null && <span>Impressions: {m.impressions?.toLocaleString?.() ?? m.impressions}</span>}
                {m.likes != null && <span>Likes: {m.likes?.toLocaleString?.() ?? m.likes}</span>}
                {m.comments != null && <span>Comments: {m.comments?.toLocaleString?.() ?? m.comments}</span>}
                {m.engagement != null && <span>Engagement: {m.engagement?.toLocaleString?.() ?? m.engagement}</span>}
                {m.reach != null && <span>Reach: {m.reach?.toLocaleString?.() ?? m.reach}</span>}
                {m.retweets != null && <span>Retweets: {m.retweets?.toLocaleString?.() ?? m.retweets}</span>}
                {m.replies != null && <span>Replies: {m.replies?.toLocaleString?.() ?? m.replies}</span>}
                {m.engagedUsers != null && <span>Engaged: {m.engagedUsers?.toLocaleString?.() ?? m.engagedUsers}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="posts-modal__analytics-empty">Click Refresh to fetch analytics from platforms.</p>
      )}
    </div>
  );
}

export default function Posts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewPost, setViewPost] = useState(null);
  const [editPost, setEditPost] = useState(null);
  const [filters, setFilters] = useState({
    platform: '',
    status: '',
    fromDate: '',
    toDate: '',
  });

  const loadPosts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (filters.platform) params.set('platform', filters.platform);
      if (filters.status) params.set('status', filters.status);
      if (filters.fromDate) params.set('fromDate', filters.fromDate);
      if (filters.toDate) params.set('toDate', filters.toDate);
      const res = await api(`/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts || []);
      setTotal(data.total ?? 0);
    } catch (_) {
      setPosts([]);
      setTotal(0);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPosts();
  }, [filters.platform, filters.status, filters.fromDate, filters.toDate]);

  const handleExport = async (format) => {
    const params = new URLSearchParams();
    params.set('limit', '1000');
    params.set('format', format);
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.status) params.set('status', filters.status);
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    const res = await api(`/posts?${params}`);
    const text = await res.text();
    const blob = new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `posts.${format === 'csv' ? 'csv' : 'json'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    const printArea = document.getElementById('posts-print-area');
    if (printArea) {
      const w = window.open('', '_blank');
      w.document.write(`<!DOCTYPE html><html><head><title>Posts Export</title><style>
        body{font-family:system-ui;padding:24px;max-width:800px;margin:0 auto}
        .posts-item{border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:12px}
        .posts-item__content{line-height:1.5;margin-bottom:8px}
        .posts-item__meta{font-size:0.85rem;color:#666}
        h1{margin-bottom:16px}
      </style></head><body><h1>Posts & Reports</h1>${printArea.innerHTML}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => { w.print(); w.close(); }, 250);
    } else {
      window.print();
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };

  const handleDelete = async (post) => {
    if (!window.confirm('Delete this post?')) return;
    try {
      const res = await api(`/posts/${post.id}`, { method: 'DELETE' });
      if (res.ok) {
        loadPosts();
        setViewPost(null);
        setEditPost(null);
      } else {
        const d = await res.json();
        alert(d.error || 'Delete failed');
      }
    } catch (e) {
      alert(e.message || 'Delete failed');
    }
  };

  const handleSaveEdit = async () => {
    if (!editPost) return;
    try {
      const res = await api(`/posts/${editPost.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: editPost.content,
          scheduleAt: editPost.status === 'scheduled' ? editPost.scheduledAt : undefined,
        }),
      });
      if (res.ok) {
        loadPosts();
        setEditPost(null);
      } else {
        const d = await res.json();
        alert(d.error || 'Update failed');
      }
    } catch (e) {
      alert(e.message || 'Update failed');
    }
  };

  return (
    <div className="posts-page">
      <header className="posts-header">
        <button className="posts-back" onClick={() => navigate('/home')}>← Back</button>
        <h1>Posts & Reports</h1>
      </header>

      <div className="posts-toolbar">
        <div className="posts-filters">
          <select
            value={filters.platform}
            onChange={e => setFilters(p => ({ ...p, platform: e.target.value }))}
          >
            <option value="">All platforms</option>
            <option value="linkedin">LinkedIn</option>
            <option value="twitter">Twitter</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="threads">Threads</option>
          </select>
          <select
            value={filters.status}
            onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
          >
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="failed">Failed</option>
          </select>
          <input
            type="date"
            value={filters.fromDate}
            onChange={e => setFilters(p => ({ ...p, fromDate: e.target.value }))}
            placeholder="From"
          />
          <input
            type="date"
            value={filters.toDate}
            onChange={e => setFilters(p => ({ ...p, toDate: e.target.value }))}
            placeholder="To"
          />
        </div>
        <div className="posts-export">
          <span>Export:</span>
          <button onClick={() => handleExport('csv')}>CSV</button>
          <button onClick={() => handleExport('json')}>JSON</button>
          <button onClick={handleExportPDF}>PDF / Print</button>
        </div>
      </div>

      {loading ? (
        <div className="posts-loading"><LoadingScreen compact /></div>
      ) : (
        <div className="posts-list" id="posts-print-area">
          <p className="posts-count">Total: {total} posts</p>
          {posts.length === 0 ? (
            <p className="posts-empty">No posts found.</p>
          ) : (
            posts.map(post => (
              <article key={post.id} className="posts-item">
                <div className="posts-item__platforms posts-item__platforms--corner">
                  {(post.platforms || []).map((p) => (
                    <span key={p} className="posts-item__platform" title={PLATFORM_LABELS[p] || p}>
                      <PlatformLogo platform={p} size={20} />
                    </span>
                  ))}
                </div>
                <div className="posts-item__content" onClick={() => setViewPost(post)}>
                  {post.content?.slice(0, 200)}{(post.content?.length || 0) > 200 ? '…' : ''}
                </div>
                <div className="posts-item__meta">
                  <span className={`posts-item__status posts-item__status--${post.status}`}>{post.status}</span>
                  <span>{formatDate(post.publishedAt || post.scheduledAt || post.createdAt)}</span>
                </div>
                <div className="posts-item__actions">
                  <button type="button" className="posts-item__btn" onClick={() => setViewPost(post)}>View</button>
                  {(post.status === 'draft' || post.status === 'scheduled') && (
                    <button type="button" className="posts-item__btn" onClick={() => setEditPost(post)}>Edit</button>
                  )}
                  <button type="button" className="posts-item__btn posts-item__btn--danger" onClick={() => handleDelete(post)}>Delete</button>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {viewPost && (
        <div className="posts-modal-overlay" onClick={() => setViewPost(null)}>
          <div className="posts-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Post</h3>
            <div className="posts-modal__platforms">
              {(viewPost.platforms || []).map((p) => (
                <span key={p} className="posts-modal__platform" title={PLATFORM_LABELS[p] || p}>
                  <PlatformLogo platform={p} size={22} />
                  <span className="posts-modal__platform-name">{PLATFORM_LABELS[p] || p}</span>
                </span>
              ))}
            </div>
            <div className="posts-modal__meta">
              <span className={`posts-item__status posts-item__status--${viewPost.status}`}>{viewPost.status}</span>
              <span>{formatDate(viewPost.publishedAt || viewPost.scheduledAt || viewPost.createdAt)}</span>
            </div>
            <div className="posts-modal__content">{viewPost.content || '(No content)'}</div>
            {viewPost.imageUrl && (
              <div className="posts-modal__image">
                <img src={viewPost.imageUrl} alt="" />
              </div>
            )}
            {viewPost.status === 'published' && (viewPost.analytics || viewPost.platformIds) && (
              <PostAnalyticsBlock post={viewPost} onRefresh={loadPosts} />
            )}
            <div className="posts-modal__actions">
              <button onClick={() => setViewPost(null)}>Close</button>
              {(viewPost.status === 'draft' || viewPost.status === 'scheduled') && (
                <button className="posts-modal__edit" onClick={() => { setEditPost(viewPost); setViewPost(null); }}>Edit</button>
              )}
              <button className="posts-modal__delete" onClick={() => { handleDelete(viewPost); setViewPost(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {editPost && (
        <div className="posts-modal-overlay" onClick={() => setEditPost(null)}>
          <div className="posts-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit post</h3>
            <div className="posts-modal__platforms">
              {(editPost.platforms || []).map((p) => (
                <span key={p} className="posts-modal__platform" title={PLATFORM_LABELS[p] || p}>
                  <PlatformLogo platform={p} size={22} />
                  <span className="posts-modal__platform-name">{PLATFORM_LABELS[p] || p}</span>
                </span>
              ))}
            </div>
            <textarea
              className="posts-modal__textarea"
              value={editPost.content || ''}
              onChange={(e) => setEditPost((p) => ({ ...p, content: e.target.value }))}
              rows={8}
            />
            {editPost.status === 'scheduled' && (
              <div className="posts-modal__field">
                <label>Scheduled at</label>
                <input
                  type="datetime-local"
                  value={editPost.scheduledAt ? new Date(editPost.scheduledAt).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setEditPost((p) => ({ ...p, scheduledAt: new Date(e.target.value).toISOString() }))}
                />
              </div>
            )}
            <div className="posts-modal__actions">
              <button onClick={() => setEditPost(null)}>Cancel</button>
              <button className="posts-modal__save" onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
