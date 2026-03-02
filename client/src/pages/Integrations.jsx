import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth } from '../firebase';
import { api, useAuth } from '../hooks/useAuth';
import { getIntegrations, setIntegration } from '../services/firestore';
import './Integrations.css';

const PLATFORMS = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
    color: '#0a66c2',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.791-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    color: '#1877F2',
  },
  {
    id: 'twitter',
    name: 'Twitter',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    color: '#000000',
  },
  {
    id: 'threads',
    name: 'Threads',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z" />
      </svg>
    ),
    color: '#000000',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 1 0 0-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 1 1-2.88 0 1.441 1.441 0 0 1 2.88 0z" />
      </svg>
    ),
    color: '#E4405F',
  },
];

export default function Integrations() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const error = searchParams.get('error');
  const success = searchParams.get('success');

  useEffect(() => {
    loadIntegrations();
  }, [user?.id]);

  useEffect(() => {
    const onMessage = (e) => {
      if (e.data?.type === 'blazly-oauth-callback') {
        if (e.data.error) {
          alert(e.data.error);
          return;
        }
        const { platform, userId, ...data } = e.data;
        if (platform && userId) {
          setIntegration(userId, platform, data).then(() => {
            loadIntegrations();
            window.dispatchEvent(new CustomEvent('integrations-changed'));
          });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const loadIntegrations = async () => {
    if (!auth.currentUser) return;
    try {
      const data = await getIntegrations(auth.currentUser.uid);
      setIntegrations(data);
    } catch (err) {
      console.error('Error loading integrations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (platformId) => {
    if (!auth.currentUser) {
      alert('Please sign in first');
      return;
    }
    if (connecting === platformId) return; // Prevent double-click
    setConnecting(platformId);
    try {
      const res = await api(`/auth/integrations/${platformId}`, {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401) {
        alert('Session expired. Please sign in again.');
        window.location.href = '/?next=' + encodeURIComponent('/integrations');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const url = data.redirectUrl || res.headers.get('Location');
      if (url) {
        const popup = window.open(url, `oauth_${platformId}`, 'width=600,height=700');
        if (!popup) alert('Popup blocked. Please allow popups for this site.');
      } else {
        alert(data.error || 'Failed to start connection. Please try again.');
      }
    } catch (_) {
      alert('Failed to start connection. Please ensure you are logged in.');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (integration, platform) => {
    if (!confirm(`Are you sure you want to disconnect ${platform.name}?`)) return;
    setDisconnecting(integration.id || integration._id);
    try {
      await setIntegration(auth.currentUser.uid, platform.id, { isActive: false });
      await loadIntegrations();
      window.dispatchEvent(new CustomEvent('integrations-changed'));
    } catch (err) {
      console.error('Error disconnecting:', err);
    } finally {
      setDisconnecting(null);
    }
  };

  const getIntegration = (platformId) => {
    return integrations.find((i) => i.platform === platformId);
  };

  if (loading) {
    return (
      <div className="integrations">
        <div className="integrations__loading">Loading integrations...</div>
      </div>
    );
  }

  return (
    <div className="integrations">
      <div className="integrations__header">
        <h1 className="integrations__title">Integrations</h1>
        <p className="integrations__subtitle">
          Connect your social media accounts to start posting
        </p>
      </div>

      {error && (
        <div className="integrations__alert integrations__alert--error">
          {decodeURIComponent(error)}
        </div>
      )}

      {success && (
        <div className="integrations__alert integrations__alert--success">
          Successfully connected to {success}!
        </div>
      )}

      <div className="integrations__grid">
        {PLATFORMS.map((platform) => {
          const integration = getIntegration(platform.id);
          const isConnected = !!integration;
          const isDisconnecting = integration && disconnecting === integration.id;

          return (
            <div key={platform.id} className={`integrations__card ${isConnected ? 'integrations__card--connected' : ''}`}>
              <div className="integrations__card-icon" style={{ color: platform.color }}>
                {platform.icon}
              </div>
              <h3 className="integrations__card-name">{platform.name}</h3>
              {isConnected && integration.profile?.name && (
                <p className="integrations__card-account">Connected as {integration.profile.name}</p>
              )}
              <div className="integrations__card-actions">
                {isConnected ? (
                  <>
                    <span className="integrations__status integrations__status--connected">Connected</span>
                    <button
                      className="integrations__button integrations__button--disconnect"
                      onClick={() => handleDisconnect(integration, platform)}
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </>
                ) : (
                  <button
                    className="integrations__button integrations__button--connect"
                    onClick={() => handleConnect(platform.id)}
                    disabled={connecting === platform.id}
                  >
                    {connecting === platform.id ? 'Opening…' : 'Connect'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
