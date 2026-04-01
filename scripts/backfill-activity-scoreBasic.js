/**
 * One-time backfill: add `scoreBasic` to existing docs in the `activity` collection.
 * Looks up each activity's user rating to get the scoreBasic value.
 *
 * Rating doc path:
 *   Movie/TV whole-show: users/{uid}/ratings/{mediaType}_{mediaId}
 *   TV season:           users/{uid}/ratings/tv_{mediaId}/seasons/{season}
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-activity-scoreBasic.js --yes
 */
/* eslint-disable no-console */

const admin = require('firebase-admin');

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path to your Firebase service account JSON.');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  console.log('Scanning activity collection...');
  const snap = await db.collection('activity').get();
  console.log(`Found ${snap.size} activity doc(s).`);

  let missing = 0;
  for (const d of snap.docs) {
    const data = d.data() || {};
    if (data.scoreBasic == null) missing += 1;
  }
  console.log(`Docs missing scoreBasic: ${missing}`);

  if (missing === 0) {
    console.log('Nothing to do.');
    return;
  }

  const proceed = await (async () => {
    if (process.argv.includes('--yes')) return true;
    process.stdout.write('Proceed with updates? Type "yes" to continue: ');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question('', (answer) => {
        rl.close();
        resolve(String(answer || '').trim().toLowerCase() === 'yes');
      });
    });
  })();

  if (!proceed) {
    console.log('Aborted. No changes made.');
    return;
  }

  // Cache rating lookups: "uid:mediaType_mediaId" or "uid:tv_mediaId_season_N" → scoreBasic
  const ratingCache = new Map();

  async function lookupScoreBasic(uid, mediaType, mediaId, season) {
    let ratingPath;
    let cacheKey;
    if (mediaType === 'tv' && season != null) {
      ratingPath = `users/${uid}/ratings/tv_${mediaId}/seasons/${season}`;
      cacheKey = `${uid}:tv_${mediaId}_s${season}`;
    } else {
      ratingPath = `users/${uid}/ratings/${mediaType}_${mediaId}`;
      cacheKey = `${uid}:${mediaType}_${mediaId}`;
    }

    if (ratingCache.has(cacheKey)) return ratingCache.get(cacheKey);

    const ratingDoc = await db.doc(ratingPath).get();
    let score = null;
    if (ratingDoc.exists) {
      const rd = ratingDoc.data();
      score = rd.scoreBasic ?? rd.score ?? null;
    }
    ratingCache.set(cacheKey, score);
    return score;
  }

  const batchSize = 500;
  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};

    if (data.scoreBasic != null) {
      skipped += 1;
      continue;
    }

    const { uid, mediaType, mediaId, season } = data;
    if (!uid || !mediaType || mediaId == null) {
      console.warn(`Skipping ${d.id}: missing uid/mediaType/mediaId`);
      skipped += 1;
      continue;
    }

    const scoreBasic = await lookupScoreBasic(uid, mediaType, mediaId, season ?? null);
    if (scoreBasic == null) {
      console.warn(`No rating found for ${d.id} (uid=${uid}, ${mediaType}_${mediaId}${season != null ? ' S' + season : ''})`);
      notFound += 1;
      continue;
    }

    batch.update(d.ref, { scoreBasic });
    batchCount += 1;
    updated += 1;

    if (batchCount >= batchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      console.log(`Committed updates so far: ${updated}`);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`\nDone. Updated: ${updated}, skipped (already had scoreBasic): ${skipped}, rating not found: ${notFound}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
