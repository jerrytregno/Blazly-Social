import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingScreen from '../components/LoadingScreen';
import './InstagramAccountSelection.css';

export default function InstagramAccountSelection() {
  const navigate = useNavigate();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/auth/integrations/instagram/accounts', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setPages(data.pages || []);
        }
      })
      .catch((err) => {
        setError('Failed to load Instagram accounts. Please try again.');
        console.error('Error loading accounts:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSelectAccount = async (pageId) => {
    setSelecting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/integrations/instagram/select-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pageId }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setSelecting(false);
      } else {
        window.location.href = '/home?integration=instagram&status=connected';
      }
    } catch (err) {
      setError('Failed to select account. Please try again.');
      setSelecting(false);
      console.error('Error selecting account:', err);
    }
  };

  if (loading) {
    return (
      <div className="instagram-account-selection">
        <div className="instagram-account-selection__card instagram-account-selection__card--loading">
          <LoadingScreen compact />
        </div>
      </div>
    );
  }

  if (error && pages.length === 0) {
    return (
      <div className="instagram-account-selection">
        <div className="instagram-account-selection__card">
          <div className="instagram-account-selection__error">{error}</div>
          <button
            className="instagram-account-selection__retry"
            onClick={() => (window.location.href = '/api/auth/integrations/instagram')}
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="instagram-account-selection">
      <div className="instagram-account-selection__card">
        <h1 className="instagram-account-selection__title">Select an Instagram Account</h1>
        <p className="instagram-account-selection__subtitle">
          Choose the Instagram Business account you want to post to.
        </p>

        {error && <div className="instagram-account-selection__error">{error}</div>}

        {pages.length === 0 ? (
          <div className="instagram-account-selection__empty">
            <p>No Instagram Business accounts found. Please link an Instagram Business/Creator account to a Facebook Page first.</p>
            <button
              className="instagram-account-selection__retry"
              onClick={() => (window.location.href = '/api/auth/integrations/instagram')}
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="instagram-account-selection__list">
            {pages.map((page) => {
              const ig = page.instagram_business_account;
              return (
                <button
                  key={page.id}
                  className="instagram-account-selection__item"
                  onClick={() => handleSelectAccount(page.id)}
                  disabled={selecting}
                >
                  <div className="instagram-account-selection__item-info">
                    {ig?.profile_picture_url && (
                      <img
                        src={ig.profile_picture_url}
                        alt=""
                        className="instagram-account-selection__item-avatar"
                      />
                    )}
                    <div>
                      <h3 className="instagram-account-selection__item-name">
                        {ig?.username || page.name}
                      </h3>
                      <p className="instagram-account-selection__item-page">
                        via {page.name}
                      </p>
                    </div>
                  </div>
                  {selecting ? (
                    <div className="instagram-account-selection__spinner">...</div>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
