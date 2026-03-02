import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { getPosts, getIntegrations } from '../services/firestore';
import PostComposer from '../components/PostComposer';
import PostList from '../components/PostList';
import Integrations from './Integrations';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState([]);

  const loadPosts = () => {
    const uid = auth.currentUser?.uid || user?.id;
    if (!uid) return setLoading(false);
    getPosts(uid, { limit: 50 })
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  };

  const loadIntegrations = () => {
    const uid = auth.currentUser?.uid || user?.id;
    if (!uid) return;
    getIntegrations(uid).then(setIntegrations).catch(() => setIntegrations([]));
  };

  useEffect(() => {
    loadPosts();
    loadIntegrations();
  }, [user?.id]);

  useEffect(() => {
    const onChanged = () => { loadIntegrations(); loadPosts(); };
    window.addEventListener('integrations-changed', onChanged);
    return () => window.removeEventListener('integrations-changed', onChanged);
  }, []);

  const name = user?.name || [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ') || 'User';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
    { id: 'integrations', label: 'Integrations', path: '/integrations' },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <div className="dashboard">
      <aside className="dashboard__sidebar">
        <div className="dashboard__brand">
          <span className="dashboard__logo">B</span>
          <span className="dashboard__title">Blazly</span>
        </div>
        <nav className="dashboard__nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`dashboard__nav-item ${isActive(item.path) ? 'dashboard__nav-item--active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="dashboard__sidebar-footer">
          <div className="dashboard__user">
            {user?.profile?.profilePicture && (
              <img
                src={user.profile.profilePicture}
                alt=""
                className="dashboard__avatar"
              />
            )}
            <span className="dashboard__name">{name}</span>
          </div>
          <button type="button" className="dashboard__logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard__main">
        {location.pathname === '/dashboard' && (
          <>
            <section className="dashboard__composer">
              <PostComposer onSuccess={loadPosts} integrations={integrations} />
            </section>
            <section className="dashboard__posts">
              <h2 className="dashboard__section-title">Your posts</h2>
              {loading ? (
                <p className="dashboard__loading">Loading posts…</p>
              ) : (
                <PostList posts={posts} onUpdate={loadPosts} />
              )}
            </section>
          </>
        )}
        {location.pathname === '/integrations' && (
          <Integrations />
        )}
      </main>
    </div>
  );
}
