import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth, api } from '../hooks/useAuth';
import { getIntegrations } from '../services/firestore';
import PlatformLogo from './PlatformLogo';
import './AppLayout.css';

const platformLabels = { linkedin: 'LinkedIn', facebook: 'Facebook', twitter: 'X', instagram: 'Instagram', threads: 'Threads' };

const NavIcon = ({ d, viewBox = '0 0 24 24' }) => (
  <svg width="20" height="20" viewBox={viewBox} fill="currentColor"><path d={d} /></svg>
);

const GREETINGS = {
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good night' },
  es: { morning: 'Buenos dias', afternoon: 'Buenas tardes', evening: 'Buenas noches', night: 'Buenas noches' },
};

function getGreeting() {
  const hour = new Date().getHours();
  const locale = (navigator.language || 'en').split('-')[0];
  const t = GREETINGS[locale] || GREETINGS.en;
  let period;
  if (hour >= 5 && hour < 12) period = t.morning;
  else if (hour >= 12 && hour < 17) period = t.afternoon;
  else if (hour >= 17 && hour < 21) period = t.evening;
  else period = t.night;
  return { text: period, icon: hour >= 5 && hour < 18 ? 'sun' : 'moon' };
}

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" /></svg>
);
const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
);

const navItems = [
  { path: '/home', label: 'Home', icon: <NavIcon d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" /> },
  { path: '/posts', label: 'Posts', icon: <NavIcon d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" /> },
  { path: '/report', label: 'Report', icon: <NavIcon d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" /> },
  { path: '/keyword-alerts', label: 'Keyword Alerts', icon: <NavIcon d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" /> },
  { path: '/ideas', label: 'Ideas', icon: <NavIcon d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" /> },
  { path: '/planner', label: 'Plan', icon: <NavIcon d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z" /> },
  { path: '/inbox', label: 'Inbox', icon: <NavIcon d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /> },
  { path: '/integrations', label: 'Integrations', icon: <NavIcon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /> },
  { path: '/profile/competitors', label: 'Competitors', icon: <NavIcon d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z" viewBox="0 0 24 24" /> },
];

export default function AppLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifDismissed, setNotifDismissed] = useState(() => {
    try {
      const d = localStorage.getItem('app_ideas_notif_dismiss');
      if (!d) return false;
      const t = JSON.parse(d);
      return t && Date.now() - t < 24 * 60 * 60 * 1000;
    } catch (_) { return false; }
  });

  const loadIntegrations = () => {
    const uid = auth.currentUser?.uid || user?.id;
    if (!uid) return setIntegrations([]);
    getIntegrations(uid).then(setIntegrations).catch(() => setIntegrations([]));
  };

  useEffect(() => {
    loadIntegrations();
    const params = new URLSearchParams(location.search);
    if (params.get('integration') && params.get('status') === 'connected') loadIntegrations();
  }, [user?.id, location.search, location.pathname]);

  useEffect(() => {
    const onIntegrationsChanged = () => loadIntegrations();
    window.addEventListener('integrations-changed', onIntegrationsChanged);
    return () => window.removeEventListener('integrations-changed', onIntegrationsChanged);
  }, []);

  const handleConnectPlatform = async (p) => {
    const arr = Array.isArray(integrations) ? integrations : [];
    const int = arr.find((i) => i.platform === p && i.isActive);
    if (int) {
      navigate(`/home?platform=${p}`);
      return;
    }
    if (!auth.currentUser) {
      alert('Please sign in first');
      navigate('/');
      return;
    }
    try {
      const res = await api(`/auth/integrations/${p}`, {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401) {
        alert('Session expired. Please sign in again.');
        navigate('/?next=' + encodeURIComponent('/integrations'));
        return;
      }
      const data = await res.json().catch(() => ({}));
      const url = data.redirectUrl || res.headers.get('Location');
      if (url) {
        const popup = window.open(url, 'oauth', 'width=600,height=700');
        if (!popup) window.location.href = url;
      } else {
        alert(data.error || 'Failed to start connection.');
      }
    } catch (_) { alert('Failed to start connection.'); }
  };

  const dismissNotif = () => {
    setNotifDismissed(true);
    try { localStorage.setItem('app_ideas_notif_dismiss', JSON.stringify(Date.now())); } catch (_) {}
  };

  const isActive = (path) => location.pathname === path;

  const connectedIntegrations = Array.isArray(integrations) ? integrations.filter((i) => i.isActive) : [];
  const userName = user?.name || [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'there';
  const { text: greetingText, icon: greetingIcon } = getGreeting();

  return (
    <div className="app-layout">
      {!notifDismissed && (
        <div className="app-layout__top-notif">
          <span>You have content suggestions</span>
          <button onClick={() => { navigate('/ideas'); dismissNotif(); }}>View Ideas</button>
          <button className="app-layout__notif-dismiss" onClick={dismissNotif} aria-label="Dismiss">x</button>
        </div>
      )}

      <div className="app-layout__body">
        <aside className="app-layout__sidebar">
          <div className="app-layout__sidebar-inner">
            <div className="app-layout__sidebar-brand" onClick={() => navigate('/home')}>
              <span className="app-layout__sidebar-logo">B</span>
              <span className="app-layout__sidebar-name">Blazly</span>
            </div>

            {user && (
              <div className="app-layout__sidebar-greeting">
                <span className={`app-layout__sidebar-greeting-icon ${greetingIcon === 'moon' ? 'moon' : ''}`}>
                  {greetingIcon === 'sun' ? <SunIcon /> : <MoonIcon />}
                </span>
                <span className="app-layout__sidebar-greeting-text">{greetingText}, {userName}</span>
              </div>
            )}

            <div className="app-layout__sidebar-section">
              <span className="app-layout__sidebar-section-title">Menu</span>
              {navItems.map(({ path, label, icon }) => (
                <button
                  key={path}
                  className={`app-layout__sidebar-item ${isActive(path) ? 'active' : ''}`}
                  onClick={() => { navigate(path === '/home' ? { pathname: '/home', search: '' } : path); setMenuOpen(false); }}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="app-layout__sidebar-section">
              <span className="app-layout__sidebar-section-title">Integrations</span>
              {connectedIntegrations.map((int) => (
                <button
                  key={int.platform}
                  className="app-layout__sidebar-item app-layout__sidebar-item--integrated"
                  onClick={() => handleConnectPlatform(int.platform)}
                  title={platformLabels[int.platform]}
                >
                  <PlatformLogo platform={int.platform} size={20} />
                  <span>{platformLabels[int.platform]}</span>
                  <span className="app-layout__sidebar-dot" />
                </button>
              ))}
              <button className="app-layout__sidebar-item app-layout__sidebar-connect" onClick={() => navigate('/integrations')}>
                {connectedIntegrations.length > 0 ? 'Manage' : '+ Connect platforms'}
              </button>
            </div>

            <div className="app-layout__sidebar-spacer" />

            <div className="app-layout__sidebar-section app-layout__sidebar-footer">
              <button className="app-layout__sidebar-item" onClick={() => navigate('/profile')}>
                <NavIcon d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                <span>Profile</span>
              </button>
              <button className="app-layout__sidebar-item app-layout__sidebar-signout" onClick={logout}>
                <NavIcon d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </aside>

        <div className="app-layout__content">
          <header className="app-layout__header">
            <div className="app-layout__header-spacer" />
            <button className="app-layout__hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
              <span /><span /><span />
            </button>
          </header>

          {menuOpen && (
            <div className="app-layout__mobile-menu">
              {navItems.map(({ path, label, icon }) => (
                <button key={path} className={`app-layout__mobile-item ${isActive(path) ? 'active' : ''}`} onClick={() => { navigate(path === '/home' ? { pathname: '/home', search: '' } : path); setMenuOpen(false); }}>
                  <span className="app-layout__mobile-icon">{icon}</span>
                  {label}
                </button>
              ))}
              <button className="app-layout__mobile-item" onClick={() => { navigate('/profile'); setMenuOpen(false); }}>Profile</button>
              <button className="app-layout__mobile-item" onClick={() => { logout(); setMenuOpen(false); }}>Sign out</button>
            </div>
          )}

          <main className="app-layout__main">{children}</main>
        </div>
      </div>
    </div>
  );
}
