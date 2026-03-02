import { config } from '../config.js';

/**
 * Convert relative /uploads URLs to absolute for platforms (Instagram, LinkedIn, Facebook) that require
 * publicly reachable URLs. Firebase Storage URLs (https://firebasestorage.googleapis.com/... or
 * https://*.firebasestorage.app/...) are already absolute and returned unchanged.
 */
export function resolveImageUrl(url) {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) return url;
  if (!url.startsWith('/') || (!url.startsWith('/uploads') && !url.startsWith('/api/'))) return url;
  const base = (config.apiPublicUrl || config.uploadBaseUrl || '').trim();
  if (!base || (!base.startsWith('http://') && !base.startsWith('https://'))) return url;
  return `${base.replace(/\/$/, '')}${url}`;
}
