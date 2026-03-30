#!/usr/bin/env node
/**
 * Backfill script: populate the `activity` Firestore collection from existing
 * users/{uid}/ratings data and link to any pre-existing discussion threads.
 *
 * Usage:
 *   1. Download a Firebase service account key JSON from the Firebase console:
 *      Project Settings → Service accounts → Generate new private key
 *   2. Set the path to it:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *      OR pass it inline:
 *        node scripts/backfill-activity.js --key /path/to/serviceAccount.json
 *   3. Run:
 *        node scripts/backfill-activity.js
 *      Add --dry-run to preview without writing.
 *
 * What it does:
 *   - Iterates every user → every top-level rating doc + TV season sub-docs
 *   - For ratings with a note, checks mediaDiscussions/{mediaKey}/threads for
 *     a thread by the same uid (to link threadId ↔ activityId)
 *   - Writes activity/{uuid} documents (and patches threads with activityId)
 *   - Skips any activity doc whose activityId already exists (idempotent)
 *   - Batches Firestore writes (500 ops per batch)
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { randomUUID } = require('crypto');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const keyArg = args.indexOf('--key');
const keyPath = keyArg !== -1 ? args[keyArg + 1] : null;

if (keyPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(keyPath);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'Error: GOOGLE_APPLICATION_CREDENTIALS not set.\n' +
    'Set it to the path of your Firebase service account JSON or pass --key <path>.'
  );
  process.exit(1);
}

initializeApp({ credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) });
const db = getFirestore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mediaKeyFor(mediaType, mediaId) {
  return `${mediaType}_${mediaId}`;
}

/**
 * Parse a rating doc ID back to { mediaType, mediaId, season }.
 * Doc ID formats:
 *   movie_{tmdbId}        → movie
 *   tv_{tmdbId}           → tv whole-show (lives at ratings/{tv_id})
 *   season doc IDs are just numbers (the season number), stored in the seasons subcollection
 */
function parseRatingDocId(docId) {
  if (docId.startsWith('movie_')) {
    return { mediaType: 'movie', mediaId: docId.replace('movie_', ''), season: null };
  }
  if (docId.startsWith('tv_')) {
    return { mediaType: 'tv', mediaId: docId.replace('tv_', ''), season: null };
  }
  // Numeric → season doc
  const num = parseInt(docId, 10);
  if (!isNaN(num)) {
    return { mediaType: 'tv', mediaId: null, season: num }; // mediaId filled in by caller
  }
  return null;
}

/** ISO8601 UTC string — lexicographically sortable, used as cursor in iOS queries */
function toISO(date) {
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function sentimentLabel(s) {
  // Normalize various stored spellings
  if (!s) return 'okay';
  const map = { 'not-good': 'not-good', 'notGood': 'not-good', okay: 'okay', good: 'good', amazing: 'amazing' };
  return map[s] || s;
}

// ---------------------------------------------------------------------------
// Batch writer (max 500 ops per commit)
// ---------------------------------------------------------------------------

class BatchWriter {
  constructor() {
    this._batch = db.batch();
    this._ops = 0;
    this._total = 0;
  }

  set(ref, data) {
    if (DRY_RUN) { this._total++; return; }
    this._batch.set(ref, data);
    this._ops++;
    this._total++;
    if (this._ops >= 490) this._flush();
  }

  update(ref, data) {
    if (DRY_RUN) { this._total++; return; }
    this._batch.update(ref, data);
    this._ops++;
    this._total++;
    if (this._ops >= 490) this._flush();
  }

  async _flush() {
    if (this._ops === 0) return;
    await this._batch.commit();
    this._batch = db.batch();
    this._ops = 0;
  }

  async commit() {
    await this._flush();
    return this._total;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Starting backfill${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…\n`);

  const writer = new BatchWriter();
  let activityCreated = 0;
  let threadsLinked = 0;
  let skipped = 0;

  // 1. Load all users
  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} users`);

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data();
    const username = userData.username || 'unknown';
    const photoURL = userData.photoURL || null;

    // 2. Load all top-level rating docs for this user
    const ratingsSnap = await db.collection('users').doc(uid).collection('ratings').get();
    if (ratingsSnap.empty) continue;

    for (const ratingDoc of ratingsSnap.docs) {
      const docId = ratingDoc.id;
      const parsed = parseRatingDocId(docId);
      if (!parsed) continue;

      const { mediaType, season } = parsed;
      const mediaId = parsed.mediaId;

      if (mediaType === 'tv' && season === null) {
        // This is a TV whole-show rating at tv_{mediaId}
        await processRatingDoc({
          uid, username, photoURL,
          ratingData: ratingDoc.data(),
          mediaType: 'tv',
          mediaId,
          season: null,
          writer,
          counters: { activityCreated, threadsLinked, skipped },
        });
        // Also process season sub-docs
        const seasonsSnap = await ratingDoc.ref.collection('seasons').get();
        for (const seasonDoc of seasonsSnap.docs) {
          const seasonNum = parseInt(seasonDoc.id, 10);
          if (isNaN(seasonNum)) continue;
          await processRatingDoc({
            uid, username, photoURL,
            ratingData: seasonDoc.data(),
            mediaType: 'tv',
            mediaId,
            season: seasonNum,
            writer,
            counters: { activityCreated, threadsLinked, skipped },
          });
        }
      } else if (mediaType === 'movie') {
        await processRatingDoc({
          uid, username, photoURL,
          ratingData: ratingDoc.data(),
          mediaType: 'movie',
          mediaId,
          season: null,
          writer,
          counters: { activityCreated, threadsLinked, skipped },
        });
      }
    }

    // Update running counters from the mutable objects passed to processRatingDoc
    // (they're passed by reference in the counters object but we reassign below)
  }

  const total = await writer.commit();
  console.log(`\nDone.`);
  console.log(`  Firestore ops queued: ${total}`);
  if (DRY_RUN) console.log('  (Dry run — nothing written)');
}

// Track created activity IDs to avoid duplicates within this run
const createdKeys = new Set();

async function processRatingDoc({ uid, username, photoURL, ratingData, mediaType, mediaId, season, writer, counters }) {
  if (!mediaId) return;

  const dedupeKey = `${uid}|${mediaType}|${mediaId}|${season ?? 'show'}`;
  if (createdKeys.has(dedupeKey)) {
    counters.skipped++;
    return;
  }

  // Build activity fields
  const mediaKey = mediaKeyFor(mediaType, mediaId);
  const mediaName = ratingData.mediaName || ratingData.title || null;
  const sentiment = sentimentLabel(ratingData.sentiment);
  const note = ratingData.note || null;
  const posterPath = ratingData.posterPath || null;

  // Parse timestamp
  let createdAt;
  if (ratingData.timestamp) {
    createdAt = new Date(ratingData.timestamp);
  } else if (ratingData.createdAt) {
    createdAt = ratingData.createdAt instanceof Timestamp
      ? ratingData.createdAt.toDate()
      : new Date(ratingData.createdAt);
  } else {
    createdAt = new Date();
  }

  if (!mediaName) {
    // Skip ratings with no media name — can't build a useful feed card
    counters.skipped++;
    return;
  }

  // 3. Check for an existing linked discussion thread (only relevant when note exists)
  let threadId = null;
  if (note) {
    const threadsSnap = await db
      .collection('mediaDiscussions')
      .doc(mediaKey)
      .collection('threads')
      .where('uid', '==', uid)
      .where('text', '==', note)
      .limit(1)
      .get();

    if (!threadsSnap.empty) {
      const threadDoc = threadsSnap.docs[0];
      // Only link if not already linked to another activity
      const existingActivityId = threadDoc.data().activityId;
      if (!existingActivityId) {
        threadId = threadDoc.id;
      } else {
        // Already linked — skip creating a duplicate activity
        counters.skipped++;
        return;
      }
    }
  }

  // 4. Create activity document
  const activityId = randomUUID();
  const activityData = {
    uid,
    username,
    photoURL,
    type: 'rating',
    mediaId: String(mediaId),
    mediaType,
    mediaName,
    posterPath,
    sentiment,
    note,
    season: season ?? null,
    createdAt: toISO(createdAt),
    mediaKey,
    threadId,
    voteCount: 0,
    upvoterUids: [],
    commentCount: 0,
  };

  const activityRef = db.collection('activity').doc(activityId);
  writer.set(activityRef, activityData);
  createdKeys.add(dedupeKey);
  counters.activityCreated++;

  // 5. Patch thread with activityId back-reference
  if (threadId) {
    const threadRef = db
      .collection('mediaDiscussions')
      .doc(mediaKey)
      .collection('threads')
      .doc(threadId);
    writer.update(threadRef, { activityId });
    counters.threadsLinked++;
  }

  if (counters.activityCreated % 50 === 0) {
    process.stdout.write(`\r  Activity docs: ${counters.activityCreated} created, ${counters.skipped} skipped, ${counters.threadsLinked} threads linked`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
