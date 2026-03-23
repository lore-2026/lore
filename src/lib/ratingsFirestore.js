/**
 * Read/write ratings from the users/{uid}/ratings subcollection.
 * Same logical shape as before: { movie: { [sentiment]: [entries] }, tv: { ... } }
 */
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  getDoc,
  updateDoc,
  runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { enrichRatingsWithScoreBasic } from './ratingsRanking';

const BATCH_SIZE = 500;
const AGGREGATE_FIELDS = { ratingCount: 0, sumScores: 0 };

export function getRatingDocId(mediaType, mediaId, season) {
  if (mediaType === 'movie') return `movie_${mediaId}`;
  return `tv_${mediaId}_${season != null ? season : 'show'}`;
}

function getUserRatingRef(uid, mediaType, mediaId, season) {
  if (mediaType === 'movie') {
    return doc(db, 'users', uid, 'ratings', `movie_${mediaId}`);
  }
  const parentRef = doc(db, 'users', uid, 'ratings', `tv_${mediaId}`);
  return season == null ? parentRef : doc(parentRef, 'seasons', String(season));
}

function getMediaKey(mediaType, mediaId) {
  return mediaType === 'tv' ? `tv_${mediaId}` : `movie_${mediaId}`;
}

function getDenormUserRatingRef(mediaKey, uid, season) {
  const baseRef = doc(db, 'mediaRatings', mediaKey, 'userRatings', uid);
  return season == null ? baseRef : doc(baseRef, 'seasons', String(season));
}

function entryKey(mediaType, mediaId, season) {
  return `${mediaType}|${mediaId}|${season == null ? 'show' : `s${season}`}`;
}

/**
 * Get the overall average rating and count from the aggregate doc at mediaRatings/{mediaKey}.
 * @param {string} mediaKey - e.g. movie_123 or tv_456
 * @returns {Promise<{ average: number, count: number } | null>}
 */
export async function getMediaAverageRating(mediaKey) {
  if (!db || !mediaKey) return null;
  const aggRef = doc(db, 'mediaRatings', mediaKey);
  const snap = await getDoc(aggRef);
  const data = snap.exists() ? snap.data() : null;
  const count = data && typeof data.ratingCount === 'number' ? data.ratingCount : 0;
  const sum = data && typeof data.sumScores === 'number' ? data.sumScores : 0;
  if (count === 0) return null;
  const average = Math.round((sum / count) * 10) / 10;
  return { average, count };
}

/**
 * Fetch all rating docs for a user and return the nested shape:
 * { movie: { [sentiment]: [{ id, mediaId, mediaType?, mediaName?, note, score, scoreV2?, scoreBasic?, timestamp, season? }] }, tv: { ... } }
 */
export async function getRatings(uid) {
  if (!db) return { movie: {}, tv: {} };
  const colRef = collection(db, 'users', uid, 'ratings');
  const snap = await getDocs(colRef);
  const ratings = { movie: {}, tv: {} };
  for (const d of snap.docs) {
    const data = d.data();
    const mediaType = data.mediaType === 'tv' ? 'tv' : 'movie';
    const mediaId = data.mediaId;
    const pushRating = (entry) => {
      const sentiment = entry.sentiment || 'good';
      if (!ratings[entry.mediaType][sentiment]) ratings[entry.mediaType][sentiment] = [];
      ratings[entry.mediaType][sentiment].push(entry);
    };

    if (mediaType === 'movie') {
      pushRating({
        id: d.id,
        mediaId,
        mediaType: 'movie',
        mediaName: data.mediaName ?? null,
        note: data.note ?? null,
        score: data.score,
        scoreV2: data.scoreV2 ?? null,
        scoreBasic: typeof data.scoreBasic === 'number' ? data.scoreBasic : null,
        timestamp: data.timestamp ?? null,
        sentiment: data.sentiment || 'good',
      });
      continue;
    }

    pushRating({
      id: getRatingDocId('tv', mediaId, null),
      mediaId,
      mediaType: 'tv',
      mediaName: data.mediaName ?? null,
      note: data.note ?? null,
      score: data.score,
      scoreV2: data.scoreV2 ?? null,
      scoreBasic: typeof data.scoreBasic === 'number' ? data.scoreBasic : null,
      timestamp: data.timestamp ?? null,
      sentiment: data.sentiment || 'good',
    });

    const seasonsSnap = await getDocs(collection(d.ref, 'seasons'));
    seasonsSnap.forEach((seasonDoc) => {
      const seasonData = seasonDoc.data();
      const season = seasonData.season ?? Number(seasonDoc.id);
      pushRating({
        id: getRatingDocId('tv', mediaId, season),
        mediaId,
        mediaType: 'tv',
        mediaName: seasonData.mediaName ?? data.mediaName ?? null,
        note: seasonData.note ?? null,
        score: seasonData.score,
        scoreV2: seasonData.scoreV2 ?? null,
        scoreBasic: typeof seasonData.scoreBasic === 'number' ? seasonData.scoreBasic : null,
        timestamp: seasonData.timestamp ?? null,
        season,
        sentiment: seasonData.sentiment || 'good',
      });
    });
  }
  return ratings;
}

function flattenRatingsToEntries(ratings) {
  const entries = [];
  if (!ratings || typeof ratings !== 'object') return entries;
  for (const mediaType of ['movie', 'tv']) {
    const byType = ratings[mediaType];
    if (!byType || typeof byType !== 'object') continue;
    for (const sentiment of Object.keys(byType)) {
      const arr = byType[sentiment];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (!entry || entry.mediaId == null) continue;
        const docId = getRatingDocId(mediaType, entry.mediaId, entry.season);
        entries.push({
          id: docId,
          data: {
            mediaType: entry.mediaType || mediaType,
            sentiment,
            mediaId: entry.mediaId,
            mediaName: entry.mediaName ?? null,
            note: entry.note ?? null,
            score: entry.score,
            scoreV2: entry.scoreV2 ?? null,
            scoreBasic: typeof entry.scoreBasic === 'number' ? entry.scoreBasic : null,
            timestamp: entry.timestamp ?? null,
            ...(entry.season != null && { season: entry.season }),
          },
        });
      }
    }
  }
  return entries;
}

/**
 * Write the full ratings object to the subcollection (replaces existing).
 * Deletes any subcollection docs not in the new ratings.
 */
export async function saveRatings(uid, ratings) {
  if (!db) return;
  const enriched = enrichRatingsWithScoreBasic(ratings);
  const entries = flattenRatingsToEntries(enriched).map(({ data }) => data);
  const prev = flattenRatingsToEntries(await getRatings(uid)).map(({ data }) => data);
  const desired = new Map(entries.map((e) => [entryKey(e.mediaType, e.mediaId, e.season), e]));
  const existing = new Map(prev.map((e) => [entryKey(e.mediaType, e.mediaId, e.season), e]));

  // Upsert desired user docs
  for (const data of entries) {
    const ref = getUserRatingRef(uid, data.mediaType, data.mediaId, data.season);
    await setDoc(ref, {
      mediaType: data.mediaType === 'tv' ? 'tv' : 'movie',
      mediaId: data.mediaId,
      sentiment: data.sentiment,
      mediaName: data.mediaName ?? null,
      note: data.note ?? null,
      score: data.score ?? null,
      scoreV2: data.scoreV2 ?? null,
      scoreBasic: typeof data.scoreBasic === 'number' ? data.scoreBasic : null,
      timestamp: data.timestamp ?? null,
      ...(data.season != null && { season: data.season }),
    }, { merge: true });
  }

  // Delete removed user docs and denorm entries
  for (const [key, oldEntry] of existing.entries()) {
    if (desired.has(key)) continue;
    const ref = getUserRatingRef(uid, oldEntry.mediaType, oldEntry.mediaId, oldEntry.season);
    await writeBatch(db).delete(ref).commit();

    const mediaKey = getMediaKey(oldEntry.mediaType, oldEntry.mediaId);
    const ratingDocId = `${uid}_${oldEntry.season == null ? 'show' : `s${oldEntry.season}`}`;
    await deleteMediaRatingEntry(mediaKey, ratingDocId);
  }

  await syncMediaRatingsForUser(uid, entries);
}

/**
 * Delete all rating docs in the subcollection for a user.
 * Also removes this user's denormalized entries under
 * mediaRatings/{mediaKey}/userRatings/{uid_segment}
 * and updates media aggregates via deleteMediaRatingEntry.
 * Caller should also set ratingCount on the user doc.
 */
export async function deleteAllRatings(uid) {
  if (!db) return;
  const current = flattenRatingsToEntries(await getRatings(uid)).map(({ data }) => data);
  for (const entry of current) {
    const mediaKey = getMediaKey(entry.mediaType, entry.mediaId);
    const ratingDocId = `${uid}_${entry.season == null ? 'show' : `s${entry.season}`}`;
    await deleteMediaRatingEntry(mediaKey, ratingDocId);
    const userRef = getUserRatingRef(uid, entry.mediaType, entry.mediaId, entry.season);
    await writeBatch(db).delete(userRef).commit();
  }
}

/**
 * Parse a user rating doc id (users/{uid}/ratings doc id) to get mediaKey and segmentId.
 * @returns {{ mediaKey: string, segmentId: string } | null}
 */
function parseUserRatingDocId(userRatingDocId) {
  if (typeof userRatingDocId !== 'string') return null;
  if (userRatingDocId.startsWith('movie_')) {
    return { mediaKey: userRatingDocId, segmentId: 'show' };
  }
  const tvMatch = userRatingDocId.match(/^tv_(\d+)_(show|s\d+|\d+)$/);
  if (tvMatch) {
    const rawSegment = tvMatch[2];
    const segmentId = rawSegment === 'show'
      ? 'show'
      : (rawSegment.startsWith('s') ? rawSegment : `s${rawSegment}`);
    return { mediaKey: `tv_${tvMatch[1]}`, segmentId };
  }
  return null;
}

/**
 * Delete one user rating from mediaRatings and update the aggregate (ratingCount, sumScores).
 * Call when a user removes a rating (saveRatings removal or details page delete).
 */
export async function deleteMediaRatingEntry(mediaKey, ratingDocId) {
  if (!db || !mediaKey || !ratingDocId) return;
  const aggRef = doc(db, 'mediaRatings', mediaKey);
  const parsed = parseUidSegmentDocId(ratingDocId);
  if (!parsed) return;
  const userRatingRef = getDenormUserRatingRef(mediaKey, parsed.uid, parsed.season);

  await runTransaction(db, async (transaction) => {
    const [ratingSnap, aggSnap] = await Promise.all([
      transaction.get(userRatingRef),
      transaction.get(aggRef),
    ]);
    const snapData = ratingSnap.exists() ? ratingSnap.data() : {};
    const score =
      typeof snapData.scoreBasic === 'number'
        ? snapData.scoreBasic
        : (typeof snapData.score === 'number' ? snapData.score : 0);
    const agg = aggSnap.exists() ? aggSnap.data() : AGGREGATE_FIELDS;
    const count = (typeof agg.ratingCount === 'number' ? agg.ratingCount : 0) - 1;
    const sumScores = (typeof agg.sumScores === 'number' ? agg.sumScores : 0) - score;
    const newCount = Math.max(0, count);
    const newSum = newCount === 0 ? 0 : sumScores;

    transaction.delete(userRatingRef);
    transaction.set(aggRef, { ratingCount: newCount, sumScores: newSum });
  });
}

/**
 * O(1) targeted delete for a single user rating.
 * Removes the rating from users/{uid}/ratings (or nested season doc),
 * removes the denormalized mediaRatings entry, and keeps media aggregates in sync.
 */
export async function deleteSingleRatingEntry(uid, { mediaType, mediaId, season = null }) {
  if (!db || !uid || mediaId == null) return;
  const normalizedType = mediaType === 'tv' ? 'tv' : 'movie';
  const userRef = getUserRatingRef(uid, normalizedType, mediaId, season);
  const mediaKey = getMediaKey(normalizedType, mediaId);
  const ratingDocId = `${uid}_${season == null ? 'show' : `s${season}`}`;

  await deleteMediaRatingEntry(mediaKey, ratingDocId);
  await deleteDoc(userRef);
}

/**
 * Keep mediaRatings/{mediaKey}/userRatings in sync for a single user, based on
 * the flattened per-user rating entries. Also updates the aggregate (ratingCount, sumScores)
 * on the mediaRatings/{mediaKey} document.
 */
async function syncMediaRatingsForUser(uid, flattenedEntries) {
  if (!db) return;

  // Deduplicate by media + season for this user's ratings in memory.
  const byKey = new Map();
  for (const data of flattenedEntries) {
    const mediaType = data.mediaType === 'tv' ? 'tv' : 'movie';
    const mediaKey = getMediaKey(mediaType, data.mediaId);
    const segmentId = data.season != null ? `s${data.season}` : 'show';
    const key = `${mediaKey}|${segmentId}`;

    byKey.set(key, { mediaKey, segmentId, data });
  }

  for (const { mediaKey, segmentId, data } of byKey.values()) {
    const aggRef = doc(db, 'mediaRatings', mediaKey);
    const userRatingRef = getDenormUserRatingRef(mediaKey, uid, data.season);
    const numericForAgg =
      typeof data.scoreBasic === 'number'
        ? data.scoreBasic
        : (typeof data.score === 'number' ? data.score : 0);

    await runTransaction(db, async (transaction) => {
      const [existingSnap, aggSnap] = await Promise.all([
        transaction.get(userRatingRef),
        transaction.get(aggRef),
      ]);
      const agg = aggSnap.exists() ? aggSnap.data() : AGGREGATE_FIELDS;
      const count = typeof agg.ratingCount === 'number' ? agg.ratingCount : 0;
      const sumScores = typeof agg.sumScores === 'number' ? agg.sumScores : 0;

      const isUpdate = existingSnap.exists();
      const prevData = isUpdate ? existingSnap.data() : {};
      const oldScore =
        typeof prevData.scoreBasic === 'number'
          ? prevData.scoreBasic
          : (typeof prevData.score === 'number' ? prevData.score : 0);
      const newCount = isUpdate ? count : count + 1;
      const newSum = isUpdate ? sumScores - oldScore + numericForAgg : sumScores + numericForAgg;

      transaction.set(userRatingRef, {
        uid,
        mediaType: data.mediaType === 'tv' ? 'tv' : 'movie',
        mediaId: data.mediaId,
        sentiment: data.sentiment,
        mediaName: data.mediaName ?? null,
        score: data.score,
        scoreBasic: typeof data.scoreBasic === 'number' ? data.scoreBasic : null,
        note: data.note ?? null,
        timestamp: data.timestamp ?? null,
        ...(data.season != null && { season: data.season }),
      });
      transaction.set(aggRef, { ratingCount: newCount, sumScores: newSum }, { merge: true });
    });
  }
}

function parseUidSegmentDocId(ratingDocId) {
  if (typeof ratingDocId !== 'string') return null;
  const m = /^(.+)_(show|s\d+)$/.exec(ratingDocId);
  if (!m) return null;
  const uid = m[1];
  const segment = m[2];
  if (segment === 'show') return { uid, season: null };
  const season = Number(segment.slice(1));
  if (!Number.isInteger(season)) return null;
  return { uid, season };
}
