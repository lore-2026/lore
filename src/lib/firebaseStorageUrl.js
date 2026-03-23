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
 * Public read URL without a download token (requires Storage rules to allow read for this object path).
 * @param {string} bucketName - e.g. from NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * @param {string} objectPath - e.g. `avatars/{uid}`
 * @param {string | number} [version] - optional cache-busting query value (e.g. Date.now()).
 */
export function buildPublicFirebaseDownloadUrl(bucketName, objectPath, version) {
  const encoded = encodeURIComponent(objectPath);
  const base = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
  return version == null ? base : `${base}&v=${encodeURIComponent(String(version))}`;
}
