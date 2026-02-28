import { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../hooks/useAuth';
import PostList from '../components/PostList';
import LoadingScreen from '../components/LoadingScreen';
import './Home.css';

const PostComposer = lazy(() => import('../components/PostComposer'));

const PLATFORMS = ['linkedin', 'facebook', 'twitter', 'instagram', 'threads'];

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const platformParam = searchParams.get('platform');
  const ideaState = location.state || {};
  const platformFromState = ideaState.platform || platformParam;
  const [posts, setPosts] = useState([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [integrations, setIntegrations] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState(platformParam && PLATFORMS.includes(platformParam) ? platformParam : null);

  useEffect(() => {
    if (platformParam && PLATFORMS.includes(platformParam)) setSelectedPlatform(platformParam);
    else if (!platformParam) setSelectedPlatform(null);
  }, [platformParam]);

  useEffect(() => {
    if (ideaState.ideaPrompt && platformFromState) {
      setSelectedPlatform(platformFromState);
    }
  }, [ideaState.ideaPrompt, platformFromState]);

  const loadPosts = (isLoadMore = false) => {
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);
    const lastPostId = isLoadMore && posts.length > 0 ? posts[posts.length - 1].id : null;
    let query = lastPostId ? `?startAfter=${lastPostId}&limit=10` : '?limit=10';
    if (selectedPlatform) query += `&platform=${selectedPlatform}`;
    api('/posts' + query)
      .then((r) => r.json())
      .then((data) => {
        if (isLoadMore) setPosts((prev) => [...prev, ...(data.posts || [])]);
        else setPosts(data.posts || []);
        setTotalPosts(data.total || 0);
        setHasMore(data.hasMore || false);
      })
      .catch(() => { if (!isLoadMore) setPosts([]); })
      .finally(() => { setLoading(false); setLoadingMore(false); });
  };

  const loadIntegrations = () => {
    api('/integrations').then((r) => r.json()).then(setIntegrations).catch(() => setIntegrations([]));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      alert(decodeURIComponent(error));
      window.history.replaceState({}, '', window.location.pathname);
    }
    loadIntegrations();
  }, []);

  useEffect(() => { loadPosts(false); }, [selectedPlatform]);

  const handleDisconnectIntegration = async (integrationId) => {
    if (!confirm('Are you sure you want to disconnect?')) return;
    try {
      const res = await api(`/integrations/${integrationId}`, { method: 'DELETE' });
      if (res.ok) {
        loadIntegrations();
        window.dispatchEvent(new CustomEvent('integrations-changed'));
        const p = integrations.find((i) => i.id === integrationId)?.platform;
        if (p === selectedPlatform) setSelectedPlatform(null);
      }
    } catch (err) {
      alert('Failed to disconnect');
    }
  };

  useEffect(() => {
    if (selectedPlatform) loadIntegrations();
  }, [selectedPlatform]);

  const connectedCount = integrations.filter((i) => i.isActive).length;
  const [stats, setStats] = useState({ scheduled: 0, published: 0 });

  useEffect(() => {
    api('/posts?limit=500').then((r) => r.json()).then((data) => {
      const posts = data.posts || [];
      setStats({
        scheduled: posts.filter((p) => p.status === 'scheduled').length,
        published: posts.filter((p) => p.status === 'published').length,
      });
    }).catch(() => {});
  }, [selectedPlatform, totalPosts]);

  const quickActions = [
    { label: 'Create Post', desc: 'Write and share content', path: '/integrations', icon: 'edit' },
    { label: 'Content Calendar', desc: 'Plan and schedule', path: '/planner', icon: 'calendar' },
    { label: 'View Posts', desc: 'Manage your content', path: '/posts', icon: 'list' },
    { label: 'Edit Profile', desc: 'Add social accounts', path: '/profile', icon: 'link' },
  ];

  return (
    <div className="home-page">
      {!selectedPlatform ? (
        <div className="home-dashboard">
          <div className="home-dashboard__hero">
            <h1>Welcome to Blazly</h1>
            <p>
              {connectedCount > 0
                ? 'Select a platform from the left menu to create and schedule posts, or use the quick actions below.'
                : 'Connect your social accounts to get started.'}
            </p>
          </div>
          <div className="home-dashboard__stats">
            <div className="home-stat-card">
              <span className="home-stat-value">{stats.scheduled}</span>
              <span className="home-stat-label">Scheduled</span>
            </div>
            <div className="home-stat-card">
              <span className="home-stat-value">{stats.published}</span>
              <span className="home-stat-label">Published</span>
            </div>
            <div className="home-stat-card">
              <span className="home-stat-value">{connectedCount}</span>
              <span className="home-stat-label">Connected</span>
            </div>
          </div>
          <div className="home-dashboard__actions">
            <h2>Quick Actions</h2>
            <div className="home-actions-grid">
              {quickActions.map((action) => (
                <button
                  key={action.path}
                  className="home-action-card"
                  onClick={() => navigate(action.path)}
                >
                  <span className={`home-action-icon home-action-icon--${action.icon}`} />
                  <span className="home-action-label">{action.label}</span>
                  <span className="home-action-desc">{action.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {connectedCount === 0 && (
            <div className="home-dashboard__cta">
              <p>Connect LinkedIn, Facebook, X, Instagram, or Threads to start posting.</p>
              <button className="home-cta-btn" onClick={() => navigate('/integrations')}>
                Go to Integrations
              </button>
            </div>
          )}
        </div>
      ) : (
    <div className="home-content">
      {integrations.filter((i) => i.platform === selectedPlatform && i.isActive).map((integration) => (
        <header key={integration.id} className="home-hero">
          <div className="home-hero__profile">
            <img
              src={integration.profile?.profilePicture || '/default-avatar.png'}
              alt=""
              className="home-hero__avatar"
              onError={(e) => (e.target.src = 'https://ui-avatars.com/api/?name=' + (integration.profile?.name || selectedPlatform))}
            />
            <div className="home-hero__info">
              <h2>{integration.profile?.name || '-'}</h2>
              <p>@{selectedPlatform} connected</p>
            </div>
          </div>
          <button className="home-hero__disconnect" onClick={() => handleDisconnectIntegration(integration.id)}>
            Disconnect
          </button>
        </header>
      ))}

      <div className="home-grid">
        <section className="home-section">
          <Suspense fallback={<div className="home-loading"><LoadingScreen compact /></div>}>
            <PostComposer
              onSuccess={() => loadPosts(false)}
              integrations={integrations}
              selectedPlatform={selectedPlatform}
              onPlatformChange={setSelectedPlatform}
              theme={selectedPlatform === 'linkedin' ? 'linkedin' : 'standard'}
              initialIdeaPrompt={ideaState.ideaPrompt}
              initialSendNow={ideaState.sendNow}
              initialIncludeImage={ideaState.includeImage}
              contentType={ideaState.contentType}
              scheduleForLater={ideaState.scheduleForLater}
              suggestedDate={ideaState.suggestedDate}
              suggestedTime={ideaState.suggestedTime}
            />
          </Suspense>
        </section>
        <section className="home-section home-posts">
          <div className="home-section__header">
            <h3>Recent Posts</h3>
            <span className="home-count">{totalPosts}</span>
          </div>
          {loading && !loadingMore ? (
            <div className="home-loading"><LoadingScreen compact /></div>
          ) : (
            <>
              <PostList posts={posts} onUpdate={() => loadPosts(false)} />
              {hasMore && (
                <button className="home-load-more" onClick={() => loadPosts(true)} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
      )}
    </div>
  );
}
