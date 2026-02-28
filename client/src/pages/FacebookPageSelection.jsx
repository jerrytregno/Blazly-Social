import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingScreen from '../components/LoadingScreen';
import './FacebookPageSelection.css';

export default function FacebookPageSelection() {
  const navigate = useNavigate();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch pages from backend
    fetch('/api/auth/integrations/facebook/pages')
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setPages(data.pages || []);
        }
      })
      .catch(err => {
        setError('Failed to load pages. Please try again.');
        console.error('Error loading pages:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSelectPage = async (pageId) => {
    setSelecting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/integrations/facebook/select-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setSelecting(false);
      } else {
        // Redirect to home page
        window.location.href = '/home?integration=facebook&status=connected';
      }
    } catch (err) {
      setError('Failed to select page. Please try again.');
      setSelecting(false);
      console.error('Error selecting page:', err);
    }
  };

  if (loading) {
    return (
      <div className="facebook-page-selection">
        <div className="facebook-page-selection__card facebook-page-selection__card--loading">
          <LoadingScreen compact />
        </div>
      </div>
    );
  }

  if (error && pages.length === 0) {
    return (
      <div className="facebook-page-selection">
        <div className="facebook-page-selection__card">
          <div className="facebook-page-selection__error">{error}</div>
          <button
            className="facebook-page-selection__retry"
            onClick={() => window.location.href = '/api/auth/facebook'}
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="facebook-page-selection">
      <div className="facebook-page-selection__card">
        <h1 className="facebook-page-selection__title">Select a Facebook Page</h1>
        <p className="facebook-page-selection__subtitle">
          Choose the page you want to post to.
        </p>

        {error && (
          <div className="facebook-page-selection__error">{error}</div>
        )}

        {pages.length === 0 ? (
          <div className="facebook-page-selection__empty">
            <p>No pages found. Please make sure you have at least one Facebook Page.</p>
            <button
              className="facebook-page-selection__retry"
              onClick={() => window.location.href = '/api/auth/facebook'}
            >
              Sign in again
            </button>
          </div>
        ) : (
          <div className="facebook-page-selection__pages">
            {pages.map((page) => (
              <button
                key={page.id}
                className="facebook-page-selection__page"
                onClick={() => handleSelectPage(page.id)}
                disabled={selecting}
              >
                <div className="facebook-page-selection__page-info">
                  <h3 className="facebook-page-selection__page-name">{page.name}</h3>
                  {page.category && (
                    <p className="facebook-page-selection__page-category">{page.category}</p>
                  )}
                </div>
                {selecting ? (
                  <div className="facebook-page-selection__spinner">...</div>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
