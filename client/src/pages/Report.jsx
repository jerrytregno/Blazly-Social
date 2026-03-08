import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { auth } from '../firebase';
import { api } from '../hooks/useAuth';
import { getPosts, getIntegrations, updatePost, createPost } from '../services/firestore';
import LoadingScreen from '../components/LoadingScreen';
import PlatformLogo from '../components/PlatformLogo';
import './Report.css';

const PLATFORM_CONFIG = {
  linkedin: {
    label: 'LinkedIn',
    color: '#0A66C2',
    metrics: ['impressions', 'likes', 'comments'],
    keys: { impressions: 'linkedin_impressions', likes: 'linkedin_likes', comments: 'linkedin_comments' },
  },
  instagram: {
    label: 'Instagram',
    color: '#E4405F',
    metrics: ['impressions', 'likes', 'comments'],
    keys: { impressions: 'instagram_impressions', likes: 'instagram_likes', comments: 'instagram_comments' },
  },
  twitter: {
    label: 'X',
    color: '#1DA1F2',
    metrics: ['impressions', 'likes', 'retweets', 'replies'],
    keys: {
      impressions: 'twitter_impressions',
      likes: 'twitter_likes',
      retweets: 'twitter_retweets',
      replies: 'twitter_replies',
      comments: 'twitter_replies',
    },
  },
  facebook: {
    label: 'Facebook',
    color: '#1877F2',
    metrics: ['impressions', 'engagedUsers', 'reactions'],
    keys: { impressions: 'facebook_impressions', engagedUsers: 'facebook_engagedUsers', reactions: 'facebook_reactions' },
  },
  threads: {
    label: 'Threads',
    color: '#5A5A5A',
    metrics: ['views', 'likes', 'replies', 'reposts'],
    keys: {
      views: 'threads_views',
      impressions: 'threads_impressions',
      likes: 'threads_likes',
      replies: 'threads_replies',
      comments: 'threads_replies',
      reposts: 'threads_reposts',
    },
  },
};

const METRIC_LABELS = {
  impressions: 'Impressions',
  likes: 'Likes',
  comments: 'Comments',
  engagement: 'Engagement',
  retweets: 'Retweets',
  replies: 'Replies',
  engagedUsers: 'Engaged Users',
  reactions: 'Reactions',
  views: 'Views',
  reposts: 'Reposts',
};

export default function Report() {
  const navigate = useNavigate();
  const [chartData, setChartData] = useState([]);
  const [posts, setPosts] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState('impressions');
  const [allTime, setAllTime] = useState(true); // Show all published posts by default
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2); // Default: 2 years ago
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedPost, setExpandedPost] = useState(null);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Set of platform IDs the user has active integrations for
  const connectedPlatforms = new Set(integrations.filter((i) => i.isActive !== false).map((i) => i.platform));

  /** Build recharts-compatible data from a posts array (uses stored analytics if present). */
  const buildChartFromPosts = (postsArr) => {
    const byDate = {};
    postsArr.forEach((p) => {
      const d = new Date(p.publishedAt || p.createdAt);
      if (isNaN(d.getTime())) return;
      const key = d.toISOString().slice(0, 10);
      if (!byDate[key]) byDate[key] = { date: key };
      const analytics = p.analytics || {};
      (p.platforms || []).forEach((pl) => {
        const a = analytics[pl] || {};
        const cfg = PLATFORM_CONFIG[pl];
        if (cfg) {
          for (const m of cfg.metrics) {
            const chartKey = cfg.keys[m];
            if (chartKey) {
              byDate[key][chartKey] = (byDate[key][chartKey] || 0) + (a[m] || 0);
            }
          }
        }
        // Always count posts per platform so chart isn't blank before analytics refresh
        const countKey = `${pl}_count`;
        byDate[key][countKey] = (byDate[key][countKey] || 0) + 1;
      });
    });
    const rows = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    setChartData(rows);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) { setLoading(false); return; }

      // Load integrations + posts in parallel
      const [clientPosts, userIntegrations] = await Promise.all([
        getPosts(uid, { limit: 200, status: 'published' }),
        getIntegrations(uid).catch(() => []),
      ]);

      setIntegrations(userIntegrations);

      let loadedPosts = clientPosts.map((p) => ({
        ...p,
        _id: p.id || p._id,
        publishedAt: p.publishedAt || p.updatedAt || p.createdAt,
        platformResults: p.platformResults || [],
      }));

      // Apply date filter client-side
      if (!allTime && (fromDate || toDate)) {
        const from = fromDate ? new Date(fromDate) : null;
        const to = toDate ? new Date(toDate + 'T23:59:59.999Z') : null;
        loadedPosts = loadedPosts.filter((p) => {
          const d = new Date(p.publishedAt || p.createdAt);
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
      }

      setPosts(loadedPosts);
      buildChartFromPosts(loadedPosts);
    } catch (e) {
      setError(e?.message || 'Failed to load report data');
      setChartData([]);
      setPosts([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, allTime]);

  const handleRefreshAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const uid = auth.currentUser?.uid;
      const postsPayload = posts.slice(0, 30).map((p) => ({
        _id: p._id || p.id,
        platforms: p.platforms || [],
        platformIds: p.platformIds || {},
        publishedAt: p.publishedAt,
      }));
      let integrationsPayload = [];
      try {
        if (uid) integrationsPayload = await getIntegrations(uid);
      } catch (_) {}
      const body = {
        posts: postsPayload,
        integrations: integrationsPayload,
        ...(allTime ? {} : { fromDate, toDate }),
      };
      const res = await api('/reports/analytics/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok && !json.fetched && !json.error?.includes('credentials')) {
        setError(json.error || 'Analytics refresh failed. Some platforms may need re-authorization.');
      }

      // Merge analytics into posts state, persist to client Firestore, rebuild chart
      const analyticsMap = json.analyticsMap || {};
      const updatedPosts = posts.map((p) => {
        const postId = String(p._id || p.id || '');
        const freshAnalytics = analyticsMap[postId];
        if (!freshAnalytics) return p;
        // Persist analytics to client Firestore so they survive page reloads
        if (uid && postId) {
          updatePost(uid, postId, { analytics: freshAnalytics }).catch(() => {});
        }
        return { ...p, analytics: freshAnalytics };
      });

      if (Object.keys(analyticsMap).length > 0) {
        setPosts(updatedPosts);
        buildChartFromPosts(updatedPosts);
        setLoading(false);
      } else {
        // Nothing new from server — just reload from client Firestore
        await loadData();
      }
    } catch (e) {
      setError(e?.message || 'Refresh failed');
      setLoading(false);
    }
  };

  /**
   * Sync posts — removed per user request.
   * Left as a no-op to avoid breaking any stale references.
   */

  const formatValue = (v) => (v != null && typeof v === 'number' ? v.toLocaleString() : '—');

  /** Returns chart lines for a platform. Shows a line whenever the platform has posts (even if analytics = 0). */
  const getPlatformChartLines = (platformKey) => {
    const config = PLATFORM_CONFIG[platformKey];
    if (!config) return [];
    const lines = [];
    for (const m of config.metrics) {
      const key = config.keys[m];
      // Include line if any chartData row has this key defined (even if 0 — flat line shows posts exist)
      if (key && chartData.some((d) => d[key] !== undefined)) {
        lines.push({
          dataKey: key,
          name: METRIC_LABELS[m] || m,
          stroke: config.color,
        });
      }
    }
    return lines;
  };

  /** Platforms visible in the report: connected integrations + any platform that has posts */
  const platformsWithPosts = new Set(posts.flatMap((p) => p.platforms || []));
  const visiblePlatforms = Object.keys(PLATFORM_CONFIG).filter(
    (k) => connectedPlatforms.has(k) || platformsWithPosts.has(k)
  );

  return (
    <div className="report-page">
      <header className="report-header">
        <button className="report-back" onClick={() => navigate('/home')}>← Back</button>
        <h1>Analytics Report</h1>
        <p className="report-desc">
          Shows likes, comments, and impressions for all your published posts. Data is fetched from each platform&apos;s API. Click &quot;Refresh analytics&quot; to update.
        </p>
      </header>

      {error && (
        <div className="report-error" role="alert">
          {error}
        </div>
      )}

      <div className="report-filters">
        <div className="report-filter report-filter-alltime">
          <label>
            <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
            All time
          </label>
          <span className="report-filter-hint">Show all published posts (likes, comments, impressions from APIs)</span>
        </div>
        {!allTime && (
          <>
            <div className="report-filter">
              <label>From</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="report-filter">
              <label>To</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </>
        )}
        <div className="report-filter">
          <label>Metric</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="impressions">Impressions / Views</option>
            <option value="likes">Likes</option>
            <option value="comments">Comments / Replies</option>
          </select>
        </div>
        <button className="report-refresh" onClick={handleRefreshAnalytics} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh analytics'}
        </button>
        <button
          type="button"
          className="report-download"
          onClick={async () => {
            try {
              const params = new URLSearchParams();
              if (!allTime) {
                if (fromDate) params.set('fromDate', fromDate);
                if (toDate) params.set('toDate', toDate);
              }
              const res = await api(`/reports/download?${params}&format=csv`);
              if (!res.ok) throw new Error('Download failed');
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `report-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) {
              setError(e?.message || 'Download failed');
            }
          }}
          disabled={loading}
        >
          Download CSV
        </button>
        <button
          type="button"
          className="report-debug"
          onClick={async () => {
            try {
              const r = await api('/reports/debug');
              const d = await r.json();
              console.log('Report debug:', d);
              alert(`Posts: ${d.postCount}\nSample platformIds: ${JSON.stringify(d.samplePosts?.[0]?.platformIds || {}, null, 2)}\nIntegrations: ${JSON.stringify(d.integrations || [], null, 2)}`);
            } catch (e) {
              alert('Debug failed: ' + e.message);
            }
          }}
        >
          Debug
        </button>
      </div>

      {/* Prompt to refresh when posts exist but no analytics have been fetched yet */}
      {!loading && posts.length > 0 && posts.every((p) => Object.keys(p.analytics || {}).length === 0) && (
        <div className="report-analytics-hint">
          <span>📊 Analytics not loaded yet.</span>
          <button className="report-analytics-hint-btn" onClick={handleRefreshAnalytics} disabled={loading}>
            Refresh analytics now
          </button>
          <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>
            Fetches live data from Instagram, Facebook, Threads, LinkedIn, and X.
          </span>
        </div>
      )}

      {loading ? (
        <div className="report-loading"><LoadingScreen compact /></div>
      ) : (
        <>
          {/* Main line chart - all platforms combined */}
          <section className="report-section report-section-hero">
            <h2>Line chart — {METRIC_LABELS[metric] || metric} over time</h2>
            <p className="report-chart-subtitle">Compare performance across LinkedIn, Instagram, X, Facebook, and Threads</p>
            <div className="report-chart report-chart-main">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={420}>
                  <LineChart data={chartData} margin={{ top: 24, right: 32, left: 24, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#6b7280" />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      stroke="#6b7280"
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
                      label={{ value: METRIC_LABELS[metric] || metric, angle: -90, position: 'insideLeft', offset: -4, style: { fontSize: 11, fill: '#9ca3af' } }}
                    />
                    <Tooltip
                      formatter={(value, name) => [formatValue(value), name]}
                      labelFormatter={(label) => `Date: ${label}`}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: 16 }} />
                    {visiblePlatforms.map((platformKey) => {
                      const config = PLATFORM_CONFIG[platformKey];
                      if (!config) return null;
                      const key = config.keys[metric] || config.keys.impressions || config.keys.views;
                      if (!key) return null;
                      // Only render line if this platform has at least one data point
                      if (!chartData.some((d) => d[key] !== undefined)) return null;
                      return (
                        <Line
                          key={`${platformKey}-${key}`}
                          type="monotone"
                          dataKey={key}
                          name={config.label}
                          stroke={config.color}
                          strokeWidth={2.5}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          connectNulls
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="report-chart-placeholder report-chart-placeholder-large">
                  No data in this date range. Publish posts and click &quot;Refresh analytics&quot; to see your metrics.
                </div>
              )}
            </div>
          </section>

          {/* Per-platform line charts */}
          <section className="report-section">
            <h2>Per platform — line charts</h2>
            <p className="report-chart-subtitle">Impressions, likes, comments, and engagement for each connected platform</p>
            {visiblePlatforms.length === 0 && (
              <div className="report-chart-placeholder">
                No connected platforms yet. Go to <strong>Integrations</strong> to connect your accounts.
              </div>
            )}
            <div className="report-charts-grid">
              {visiblePlatforms.map((platformKey) => {
                const config = PLATFORM_CONFIG[platformKey];
                if (!config) return null;
                const lines = getPlatformChartLines(platformKey);
                const postCount = posts.filter((p) => (p.platforms || []).includes(platformKey)).length;
                const isConnected = connectedPlatforms.has(platformKey);
                return (
                  <div key={platformKey} className="report-chart-card">
                    <div className="report-chart-header">
                      <PlatformLogo platform={platformKey} size={24} />
                      <h3>{config.label}</h3>
                      {isConnected && <span className="report-connected-badge">Connected</span>}
                    </div>
                    <div className="report-chart-inner">
                      {lines.length > 0 ? (
                        <ResponsiveContainer width="100%" height={260}>
                          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                            <Tooltip
                              formatter={(value, name) => [formatValue(value), name]}
                              labelFormatter={(label) => `Date: ${label}`}
                            />
                            <Legend />
                            {lines.map((l) => (
                              <Line
                                key={l.dataKey}
                                type="monotone"
                                dataKey={l.dataKey}
                                name={l.name}
                                stroke={l.stroke}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                connectNulls
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="report-chart-placeholder">
                          {postCount > 0
                            ? `${postCount} ${config.label} post${postCount > 1 ? 's' : ''} found. Click "Refresh analytics" to load engagement data.`
                            : isConnected
                            ? `No ${config.label} posts yet. Publish a post to see analytics.`
                            : `No ${config.label} data.`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Post history */}
          <section className="report-section">
            <h2>Post history</h2>
            {posts.length === 0 ? (
              <div className="report-posts-empty">
                <p>No published posts found.</p>
                <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', opacity: 0.75 }}>
                  Posts are saved to your local storage when you publish them. If you published
                  posts before this feature was added, click <strong>Refresh analytics</strong>
                  above — the server will look them up and save them here for future visits.
                </p>
              </div>
            ) : (
              <div className="report-posts-list">
                {posts.map((post) => {
                  const isExpanded = expandedPost === post.id;
                  const analytics = post.analytics || {};
                  const hasAnalytics = Object.keys(analytics).length > 0;
                  return (
                    <div key={post.id} className="report-post-card">
                      <div
                        className="report-post-header"
                        onClick={() => setExpandedPost(isExpanded ? null : post.id)}
                      >
                        <div className="report-post-preview">
                          <span className="report-post-date">
                            {post.publishedAt ? new Date(post.publishedAt).toLocaleString() : '—'}
                          </span>
                          <p className="report-post-content">{post.content || 'No content'}</p>
                          <div className="report-post-platforms">
                            {(post.platforms || []).map((p) => (
                              <span key={p} className="report-post-platform-tag">
                                <PlatformLogo platform={p} size={14} />
                                {PLATFORM_CONFIG[p]?.label || p}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="report-post-expand">{isExpanded ? '▼' : '▶'}</span>
                      </div>
                      {isExpanded && (
                        <div className="report-post-details">
                          {hasAnalytics ? (
                            <div className="report-post-metrics">
                              {Object.entries(analytics).map(([platform, m]) => (
                                <div key={platform} className="report-post-platform-metrics">
                                  <h4>
                                    <PlatformLogo platform={platform} size={18} />
                                    {PLATFORM_CONFIG[platform]?.label || platform}
                                  </h4>
                                  <div className="report-post-metrics-grid">
                                    {m.impressions != null && (
                                      <span className="report-metric">
                                        <strong>Impressions:</strong> {formatValue(m.impressions)}
                                      </span>
                                    )}
                                    {m.likes != null && (
                                      <span className="report-metric">
                                        <strong>Likes:</strong> {formatValue(m.likes)}
                                      </span>
                                    )}
                                    {m.comments != null && (
                                      <span className="report-metric">
                                        <strong>Comments:</strong> {formatValue(m.comments)}
                                      </span>
                                    )}
                                    {m.engagement != null && (
                                      <span className="report-metric">
                                        <strong>Engagement:</strong> {formatValue(m.engagement)}
                                      </span>
                                    )}
                                    {m.retweets != null && (
                                      <span className="report-metric">
                                        <strong>Retweets:</strong> {formatValue(m.retweets)}
                                      </span>
                                    )}
                                    {m.replies != null && (
                                      <span className="report-metric">
                                        <strong>Replies:</strong> {formatValue(m.replies)}
                                      </span>
                                    )}
                                    {m.engagedUsers != null && (
                                      <span className="report-metric">
                                        <strong>Engaged users:</strong> {formatValue(m.engagedUsers)}
                                      </span>
                                    )}
                                    {m.reach != null && (
                                      <span className="report-metric">
                                        <strong>Reach:</strong> {formatValue(m.reach)}
                                      </span>
                                    )}
                                    {m.views != null && (
                                      <span className="report-metric">
                                        <strong>Views:</strong> {formatValue(m.views)}
                                      </span>
                                    )}
                                    {m.reposts != null && (
                                      <span className="report-metric">
                                        <strong>Reposts:</strong> {formatValue(m.reposts)}
                                      </span>
                                    )}
                                    {m.quotes != null && (
                                      <span className="report-metric">
                                        <strong>Quotes:</strong> {formatValue(m.quotes)}
                                      </span>
                                    )}
                                    {m.reactions != null && (
                                      <span className="report-metric">
                                        <strong>Reactions:</strong> {formatValue(m.reactions)}
                                      </span>
                                    )}
                                    {m.clicks != null && (
                                      <span className="report-metric">
                                        <strong>Clicks:</strong> {formatValue(m.clicks)}
                                      </span>
                                    )}
                                  </div>
                                  {post.platformUrls?.[platform] && (
                                    <a
                                      href={post.platformUrls[platform]}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="report-post-link"
                                    >
                                      View post →
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="report-post-no-analytics">
                              No analytics yet. Click &quot;Refresh analytics&quot; above to fetch metrics.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
