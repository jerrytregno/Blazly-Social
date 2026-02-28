import { useState, useEffect } from 'react';
import './LoadingScreen.css';

const FALLBACK_TIPS = [
  'LinkedIn: Best times Tue 11 AM, Wed 10 AM, Fri 10 AM.',
  'Write short, punchy hooks in the first line.',
  'Use 2–5 relevant hashtags on LinkedIn.',
  'Twitter: Keep posts under 280 characters for maximum visibility.',
  'Instagram: Post when your audience is most active (e.g. 11 AM–1 PM).',
  'Add a clear call-to-action in your posts.',
  'Engage with comments within the first hour for better reach.',
];

export default function LoadingScreen({ compact = false, lightBg = false }) {
  const [tips, setTips] = useState(FALLBACK_TIPS);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch('/data/tips.json')
      .then((r) => r.json())
      .then((data) => {
        const raw = [...(data.platformTips || []), ...(data.writingTips || []), ...FALLBACK_TIPS];
        const asStrings = raw.map((t) => (typeof t === 'string' ? t : t?.text ?? t?.title ?? null)).filter(Boolean);
        const unique = [...new Set(asStrings)];
        if (unique.length) setTips(unique);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % tips.length);
    }, 4000);
    return () => clearInterval(id);
  }, [tips.length]);

  return (
    <div className={`loading-screen ${compact ? 'loading-screen--compact' : ''} ${lightBg ? 'loading-screen--light-bg' : ''}`}>
      <div className="loading-screen__spinner" aria-hidden />
      <p className="loading-screen__text">Loading…</p>
      {tips[index] && typeof tips[index] === 'string' && (
        <div className="loading-screen__tip loading-screen__tip--slider">
          <span className="loading-screen__tip-badge">Pro tip</span>
          <p key={index}>{tips[index]}</p>
        </div>
      )}
    </div>
  );
}
