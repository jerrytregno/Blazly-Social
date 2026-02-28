import { api } from '../hooks/useAuth';
import './PostList.css';

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function statusLabel(status) {
  const map = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', failed: 'Failed' };
  return map[status] || status;
}

function statusClass(status) {
  const map = { draft: 'muted', scheduled: 'warning', published: 'success', failed: 'error' };
  return map[status] || 'muted';
}

const PLATFORM_ICONS = {
  instagram: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.17.054 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0-2.163c-3.259 0-3.667.014-4.947.072-1.28.057-2.147.26-2.911.557-.79.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053 0 8.333 0 8.74 0 12s.014 3.667.072 4.947c.058 1.28.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.014 4.947-.072c1.28-.057 2.148-.26 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.28-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 1 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 1 0 2.88 1.44 1.44 0 0 1 0-2.88z" />
    </svg>
  ),
  linkedin: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.98 3.5c0 1.381-1.11 2.5-2.48 2.5s-2.48-1.119-2.48-2.5c0-1.38 1.11-2.5 2.48-2.5s2.48 1.12 2.48 2.5zm.02 4.5h-5v16h5v-16zm7.982 0h-4.968v16h4.969v-8.399c0-4.67 6.029-5.052 6.029 0v8.399h4.988v-10.131c0-7.88-8.922-7.593-11.018-3.714v-2.155z" />
    </svg>
  ),
  twitter: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z" />
    </svg>
  ),
  facebook: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  ),
  threads: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.781 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142l-.126 1.974a11.881 11.881 0 0 0-2.588-.122c-1.124.068-2.013.39-2.64.956-.6.541-.93 1.258-.896 2.024.032.738.414 1.37 1.077 1.78.579.358 1.354.515 2.184.445 1.149-.096 2.025-.531 2.607-1.294.646-.847.977-2.08.977-3.662v-.617c0-3.089-1.623-4.66-4.822-4.66-1.603 0-2.886.537-3.815 1.596-.929 1.06-1.402 2.526-1.402 4.356 0 1.83.473 3.296 1.402 4.356.929 1.059 2.212 1.596 3.815 1.596 1.074 0 2.036-.23 2.86-.683l.717 1.84c-1.007.55-2.228.83-3.577.83-2.042 0-3.694-.686-4.91-2.04-1.217-1.353-1.834-3.213-1.834-5.529 0-2.316.617-4.176 1.834-5.529 1.216-1.354 2.868-2.04 4.91-2.04 4.038 0 6.822 2.298 6.822 6.66v.617c0 2.006-.458 3.585-1.361 4.698-.903 1.113-2.229 1.69-3.944 1.716z" />
    </svg>
  ),
};

export default function PostList({ posts, onUpdate }) {
  const handleDelete = (id) => {
    if (!window.confirm('Delete this post?')) return;
    api(`/posts/${id}`, { method: 'DELETE' })
      .then((r) => r.ok && onUpdate?.())
      .catch(() => { });
  };

  if (!posts?.length) {
    return (
      <div className="post-list__empty-container">
        <p className="post-list__empty">0 posts so far</p>
        <p className="post-list__empty-sub">Create your first post above to get started!</p>
      </div>
    );
  }

  return (
    <ul className="post-list">
      {posts.map((post) => {
        const mediaUrl = post.imageUrl || post.videoUrl || (post.mediaItems?.[0]?.url);
        const isVideo = post.videoUrl || post.mediaItems?.[0]?.type === 'VIDEO';

        return (
          <li key={post.id} className="post-list__item">
            <div className="post-list__main">
              {mediaUrl && (
                <div className="post-list__thumbnail">
                  {isVideo ? (
                    <div className="post-list__video-placeholder">Video</div>
                  ) : (
                    <img src={mediaUrl} alt="Preview" />
                  )}
                </div>
              )}
              <div className="post-list__details">
                <div className="post-list__platforms">
                  {(post.platforms || []).map(p => (
                    <span key={p} className={`post-list__platform-icon post-list__platform-icon--${p}`} title={p}>
                      {PLATFORM_ICONS[p] || p}
                    </span>
                  ))}
                </div>
                <p className="post-list__content">{post.content || '(No content)'}</p>
                <div className="post-list__meta">
                  <span className={`post-list__status post-list__status--${statusClass(post.status)}`}>
                    {statusLabel(post.status)}
                  </span>
                  {post.scheduledAt && post.status === 'scheduled' && (
                    <span className="post-list__date">Scheduled: {formatDate(post.scheduledAt)}</span>
                  )}
                  {post.publishedAt && (
                    <span className="post-list__date">Published: {formatDate(post.publishedAt)}</span>
                  )}
                </div>
              </div>
            </div>
            {post.error && <p className="post-list__error">{post.error}</p>}
            {(post.status === 'draft' || post.status === 'scheduled') && (
              <button
                type="button"
                className="post-list__delete"
                onClick={() => handleDelete(post.id)}
              >
                Delete
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
