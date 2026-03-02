/**
 * Request-scoped context - stores Firebase token for Firestore REST API.
 * Use when server has no service account (Vercel).
 */
import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage();

export function getToken() {
  return requestContext.getStore()?.token ?? null;
}

export function runWithToken(token, fn) {
  return requestContext.run({ token }, fn);
}
