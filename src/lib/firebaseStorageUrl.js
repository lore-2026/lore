/**
 * Helpers for Firebase Storage download URLs used in Firestore (tokenless public URLs + stripping).
 */

/**
 * Remove `token` from Firebase Storage REST URLs so they rely on Storage rules instead of capability tokens.
 * Non-Firebase URLs are returned unchanged.
 * @param {string | null | undefined} urlString
 * @returns {string | null | undefined}
 */
export function stripFirebaseStorageUrlToken(urlString) {
  if (urlString == null || typeof urlString !== 'string') return urlString;
  const trimmed = urlString.trim();
  if (!trimmed.includes('firebasestorage.googleapis.com')) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!u.searchParams.has('token')) return trimmed;
    u.searchParams.delete('token');
    if (!u.searchParams.has('alt')) {
      u.searchParams.set('alt', 'media');
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

/**
 * @param {string} bucketName
 * @param {string} objectPath - e.g. `avatars/{uid}`
 */
export function buildPublicFirebaseDownloadUrl(bucketName, objectPath) {
  const encoded = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
}
