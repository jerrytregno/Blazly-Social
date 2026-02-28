import { useState, useRef, useEffect } from 'react';
import { api } from '../hooks/useAuth';
import './KeywordPicker.css';

// Seed similar words - Reddit-style suggestions (extend via API later)
const SIMILAR_MAP = {
  marketing: ['social media', 'content', 'branding', 'advertising', 'growth', 'SEO'],
  content: ['marketing', 'social media', 'blog', 'video', 'copywriting', 'strategy'],
  social: ['media', 'marketing', 'engagement', 'community', 'influencer', 'networking'],
  business: ['startup', 'entrepreneur', 'B2B', 'B2C', 'SaaS', 'enterprise'],
  startup: ['founder', 'venture', 'growth', 'product', 'tech', 'scale'],
  ai: ['automation', 'machine learning', 'productivity', 'innovation', 'LLM'],
  productivity: ['tools', 'automation', 'workflow', 'efficiency', 'tips'],
  design: ['UX', 'UI', 'branding', 'creative', 'visual'],
  tech: ['software', 'SaaS', 'developer', 'API', 'automation'],
  leadership: ['management', 'thought leadership', 'executive', 'strategy'],
  sales: ['B2B', 'enterprise', 'growth', 'revenue', 'pipeline'],
};

const getSimilar = (word) => {
  if (!word || word.length < 2) return [];
  const lower = word.toLowerCase().trim();
  const direct = SIMILAR_MAP[lower];
  if (direct) return direct;
  const fromPartial = Object.entries(SIMILAR_MAP).flatMap(([k, vals]) =>
    (k.includes(lower) || lower.includes(k)) ? [k, ...vals] : []
  );
  const unique = [...new Set(fromPartial)].filter((s) => s !== lower).slice(0, 8);
  if (unique.length) return unique;
  return [lower];
};

export default function KeywordPicker({ value = [], onChange, placeholder = 'Add keywords…', maxKeywords = 20 }) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const inputRef = useRef();
  const keywords = Array.isArray(value) ? value : [];

  useEffect(() => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }
    const fetchOrStatic = async () => {
      setLoadingSuggestions(true);
      try {
        const res = await api(`/ai/keywords/suggest?q=${encodeURIComponent(input)}&existing=${keywords.join(',')}`);
        const data = await res.json();
        if (res.ok && data.suggestions?.length) {
          const filtered = data.suggestions.filter((s) => !keywords.includes(s));
          setSuggestions(filtered.slice(0, 10));
        } else {
          const similar = getSimilar(input);
          const filtered = similar.filter((s) => !keywords.includes(s));
          setSuggestions(filtered.length ? filtered : (input.length >= 2 ? [input.trim().toLowerCase()] : []));
        }
      } catch (_) {
        const similar = getSimilar(input);
        const filtered = similar.filter((s) => !keywords.includes(s));
        setSuggestions(filtered.length ? filtered : (input.length >= 2 ? [input.trim().toLowerCase()] : []));
      }
      setLoadingSuggestions(false);
    };
    const t = setTimeout(fetchOrStatic, 300);
    return () => clearTimeout(t);
  }, [input, keywords.join(',')]);

  const addKeyword = (kw) => {
    const k = (typeof kw === 'string' ? kw : input).trim().toLowerCase();
    if (!k || keywords.includes(k) || keywords.length >= maxKeywords) return;
    onChange([...keywords, k]);
    setInput('');
    setSuggestions([]);
  };

  const removeKeyword = (kw) => {
    onChange(keywords.filter((k) => k !== kw));
  };

  return (
    <div className="keyword-picker">
      <div className="keyword-picker-chips">
        {keywords.map((kw) => (
          <span key={kw} className="keyword-picker-chip">
            {kw}
            <button type="button" onClick={() => removeKeyword(kw)} aria-label="Remove">×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="keyword-picker-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              e.preventDefault();
              addKeyword(input);
            }
            if (e.key === 'Backspace' && !input && keywords.length) {
              removeKeyword(keywords[keywords.length - 1]);
            }
          }}
          placeholder={keywords.length >= maxKeywords ? '' : placeholder}
          disabled={keywords.length >= maxKeywords}
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="keyword-picker-suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="keyword-picker-suggestion"
              onMouseDown={() => addKeyword(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {keywords.length > 0 && (
        <span className="keyword-picker-hint">{keywords.length}/{maxKeywords}</span>
      )}
    </div>
  );
}
