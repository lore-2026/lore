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
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import { enrichRatingsWithScoreBasic } from './ratingsRanking';

const BATCH_SIZE = 500;

/** Firestore map keys under sentimentCounts (avoid hyphens in field paths). */
const SENTIMENT_TO_FIELD = {
  'not-good': 'notGood',
  okay: 'okay',
  good: 'good',
  amazing: 'amazing',
};

export function normalizeSentiment(s) {
  const key = s && typeof s === 'string' ? s : 'good';
  return SENTIMENT_TO_FIELD[key] ? key : 'good';
}

function sentimentToFirestoreField(sentiment) {
  return SENTIMENT_TO_FIELD[normalizeSentiment(sentiment)];
}

function sentimentIncrementPatch(sentiment, delta) {
  const field = sentimentToFirestoreField(sentiment);
  return { [`sentimentCounts.${field}`]: increment(delta) };
}

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
 * Real-time community sentiment for movies and whole-show TV only (season ratings excluded).
 * @param {string} mediaKey - e.g. movie_123 or tv_456
 * @returns {Promise<{ notGood: number, okay: number, good: number, amazing: number, total: number } | null>}
 */
export async function getMediaSentimentCounts(mediaKey) {
  if (!db || !mediaKey) return null;
  const aggRef = doc(db, 'mediaRatings', mediaKey);
  const snap = await getDoc(aggRef);
  const data = snap.exists() ? snap.data() : null;
  const sc = data?.sentimentCounts && typeof data.sentimentCounts === 'object' ? data.sentimentCounts : {};
  const notGood = typeof sc.notGood === 'number' ? sc.notGood : 0;
  const okay = typeof sc.okay === 'number' ? sc.okay : 0;
  const good = typeof sc.good === 'number' ? sc.good : 0;
  const amazing = typeof sc.amazing === 'number' ? sc.amazing : 0;
  const total = notGood + okay + good + amazing;
  if (total === 0) return null;
  return { notGood, okay, good, amazing, total };
}

/**
 * Denormalized copy under mediaRatings + sentimentCounts on mediaRatings/{mediaKey} (non-season only).
 * Call after writing users/{uid}/ratings.
 */
export async function upsertDenormalizedMediaRating(uid, entry) {
  if (!db || !uid || !entry || entry.mediaId == null) return;
  const mediaKey = getMediaKey(entry.mediaType === 'tv' ? 'tv' : 'movie', entry.mediaId);
  const aggRef = doc(db, 'mediaRatings', mediaKey);
  const userRef = doc(db, 'mediaRatings', mediaKey, 'userRatings', uid);
  const ratingRef = entry.mediaType === 'tv' && entry.season != null
    ? doc(userRef, 'seasons', String(entry.season))
    : userRef;

  const payload = {
    uid,
    mediaType: entry.mediaType === 'tv' ? 'tv' : 'movie',
    mediaId: entry.mediaId,
    sentiment: entry.sentiment,
    mediaName: entry.mediaName ?? null,
    note: entry.note ?? null,
    score: entry.score ?? null,
    scoreBasic: typeof entry.scoreBasic === 'number' ? entry.scoreBasic : null,
    timestamp: entry.timestamp ?? null,
    ...(entry.season != null && { season: entry.season }),
  };

  if (entry.mediaType === 'tv' && entry.season != null) {
    await setDoc(ratingRef, payload, { merge: true });
    return;
  }

  await runTransaction(db, async (transaction) => {
    const existingSnap = await transaction.get(ratingRef);
    const existed = existingSnap.exists();
    const oldSentiment = existed ? normalizeSentiment(existingSnap.data().sentiment) : null;
    const newSentiment = normalizeSentiment(entry.sentiment);

    transaction.set(ratingRef, payload, { merge: true });

    const aggUpdates = {};
    if (!existed) {
      Object.assign(aggUpdates, sentimentIncrementPatch(newSentiment, 1));
    } else if (oldSentiment !== newSentiment) {
      Object.assign(aggUpdates, sentimentIncrementPatch(oldSentiment, -1));
      Object.assign(aggUpdates, sentimentIncrementPatch(newSentiment, 1));
    }
    if (Object.keys(aggUpdates).length) {
      transaction.set(aggRef, aggUpdates, { merge: true });
    }
  });
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
 * Delete one user rating from mediaRatings and adjust sentimentCounts (non-season only).
 * Call when a user removes a rating (saveRatings removal or details page delete).
 */
export async function deleteMediaRatingEntry(mediaKey, ratingDocId) {
  if (!db || !mediaKey || !ratingDocId) return;
  const aggRef = doc(db, 'mediaRatings', mediaKey);
  const parsed = parseUidSegmentDocId(ratingDocId);
  if (!parsed) return;
  const userRatingRef = getDenormUserRatingRef(mediaKey, parsed.uid, parsed.season);

  await runTransaction(db, async (transaction) => {
    const ratingSnap = await transaction.get(userRatingRef);
    const isNonSeason = parsed.season == null;
    const sentiment = ratingSnap.exists()
      ? normalizeSentiment(ratingSnap.data().sentiment)
      : 'good';

    transaction.delete(userRatingRef);
    if (isNonSeason) {
      transaction.set(aggRef, sentimentIncrementPatch(sentiment, -1), { merge: true });
    }
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
 * the flattened per-user rating entries. Updates sentimentCounts on mediaRatings/{mediaKey}
 * for non-season rows only.
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

  for (const { mediaKey, data } of byKey.values()) {
    const aggRef = doc(db, 'mediaRatings', mediaKey);
    const userRatingRef = getDenormUserRatingRef(mediaKey, uid, data.season);

    await runTransaction(db, async (transaction) => {
      const existingSnap = await transaction.get(userRatingRef);

      const isUpdate = existingSnap.exists();
      const isNonSeason = data.season == null;
      const oldSentiment = isUpdate ? normalizeSentiment(existingSnap.data().sentiment) : null;
      const newSentiment = normalizeSentiment(data.sentiment);

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

      const aggPatch = {};
      if (isNonSeason) {
        if (!isUpdate) {
          Object.assign(aggPatch, sentimentIncrementPatch(newSentiment, 1));
        } else if (oldSentiment !== newSentiment) {
          Object.assign(aggPatch, sentimentIncrementPatch(oldSentiment, -1));
          Object.assign(aggPatch, sentimentIncrementPatch(newSentiment, 1));
        }
      }
      if (Object.keys(aggPatch).length) {
        transaction.set(aggRef, aggPatch, { merge: true });
      }
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
