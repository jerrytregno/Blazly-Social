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
import { api } from '../hooks/useAuth';
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
    color: '#000000',
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
  const [autoRefreshDone, setAutoRefreshDone] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!allTime) {
        if (fromDate) params.set('fromDate', fromDate);
        if (toDate) params.set('toDate', toDate);
      }
      const [chartRes, postsRes] = await Promise.all([
        api(`/reports/analytics?${params}`),
        api(`/reports/posts?${params}`),
      ]);
      const chartJson = await chartRes.json();
      const postsJson = await postsRes.json();
      if (!chartRes.ok) setError(chartJson.error || 'Failed to load analytics');
      if (!postsRes.ok) setError(postsJson.error || 'Failed to load posts');
      setChartData(chartJson.data || []);
      setPosts(postsJson.posts || []);
    } catch (e) {
      setError(e?.message || 'Failed to load report data');
      setChartData([]);
      setPosts([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    setAutoRefreshDone(false);
    loadData();
  }, [fromDate, toDate, allTime]);

  // Auto-refresh analytics once when we have posts but no analytics data
  useEffect(() => {
    if (loading || autoRefreshDone || chartData.length === 0 || posts.length === 0) return;
    const hasAnyAnalytics = chartData.some((d) =>
      Object.keys(PLATFORM_CONFIG).some((p) => {
        const cfg = PLATFORM_CONFIG[p];
        return Object.values(cfg.keys).some((k) => d[k] > 0);
      })
    );
    if (!hasAnyAnalytics) {
      setAutoRefreshDone(true);
      handleRefreshAnalytics();
    }
  }, [chartData.length, posts.length, loading, autoRefreshDone]);

  const handleRefreshAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = allTime ? {} : { fromDate, toDate };
      const res = await api('/reports/analytics/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Refresh failed');
      await loadData();
    } catch (e) {
      setError(e?.message || 'Refresh failed');
    }
    setLoading(false);
  };

  const formatValue = (v) => (v != null && typeof v === 'number' ? v.toLocaleString() : '—');

  const getPlatformChartLines = (platformKey) => {
    const config = PLATFORM_CONFIG[platformKey];
    if (!config) return [];
    const lines = [];
    for (const m of config.metrics) {
      const key = config.keys[m];
      if (key && chartData.some((d) => d[key] != null && d[key] > 0)) {
        lines.push({
          dataKey: key,
          name: METRIC_LABELS[m] || m,
          stroke: config.color,
        });
      }
    }
    return lines;
  };

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
                    <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
                    <Tooltip
                      formatter={(value) => [formatValue(value), '']}
                      labelFormatter={(label) => `Date: ${label}`}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: 16 }} />
                    {Object.entries(PLATFORM_CONFIG).map(([platformKey, config]) => {
                      const key = config.keys[metric] || config.keys.impressions || config.keys.views;
                      if (!key) return null;
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
            <p className="report-chart-subtitle">Impressions, likes, comments, and engagement for each platform</p>
            <div className="report-charts-grid">
              {Object.entries(PLATFORM_CONFIG).map(([platformKey, config]) => {
                const lines = getPlatformChartLines(platformKey);
                return (
                  <div key={platformKey} className="report-chart-card">
                    <div className="report-chart-header">
                      <PlatformLogo platform={platformKey} size={24} />
                      <h3>{config.label}</h3>
                    </div>
                    <div className="report-chart-inner">
                      {lines.length > 0 ? (
                        <ResponsiveContainer width="100%" height={260}>
                          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                            <Tooltip
                              formatter={(value) => [formatValue(value), '']}
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
                          No {config.label} data yet. Publish posts and click Refresh analytics.
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
              <p className="report-posts-empty">No published posts in this date range.</p>
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
