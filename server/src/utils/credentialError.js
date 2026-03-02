/**
 * Detect Google Cloud / Firebase credential errors that occur when
 * Application Default Credentials are not configured on the server.
 * Used to gracefully degrade to client-side Firestore instead of returning 500.
 */
export function isCredentialError(err) {
  const msg = err?.message || '';
  return (
    msg.includes('Could not load the default credentials') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('Application Default Credentials') ||
    msg.includes('credential') && msg.includes('not found')
  );
}
