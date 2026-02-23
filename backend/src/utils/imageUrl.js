import { config } from '../config.js';

/**
 * Convert relative /uploads URLs to absolute for platforms (Instagram, LinkedIn) that require
 * publicly reachable URLs. Returns unchanged if already absolute or base not configured.
 */
export function resolveImageUrl(url) {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) return url;
  if (!url.startsWith('/') || (!url.startsWith('/uploads') && !url.startsWith('/api/'))) return url;
  const base = (config.apiPublicUrl || config.uploadBaseUrl || '').trim();
  if (!base || (!base.startsWith('http://') && !base.startsWith('https://'))) return url;
  return `${base.replace(/\/$/, '')}${url}`;
}
