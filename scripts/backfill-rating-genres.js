/**
 * One-time backfill: add `genres` (array of genre name strings) to existing docs in
 * `users/{uid}/ratings/{ratingDocId}`.
 *
 * Fetches genre data from TMDB for each unique media and writes it to the rating doc.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-rating-genres.js --yes
 */
/* eslint-disable no-console */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.themoviedb.org/3';
let TMDB_TOKEN;

function loadEnvVarFromFile(filePath, varName) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    const line = contents
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && l.startsWith(`${varName}=`));
    if (!line) return null;
    return line.slice(varName.length + 1).trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return null;
  }
}

async function fetchGenres(mediaType, mediaId) {
  const url = `${BASE_URL}/${mediaType}/${mediaId}?language=en-US`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.genres?.map((g) => g.name) ?? null;
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path to your Firebase service account JSON.');
    process.exit(1);
  }

  // Load TMDB token
  TMDB_TOKEN = process.env.TMDB_TOKEN;
  if (!TMDB_TOKEN) {
    const candidates = ['.env.local', '.env'].map((p) => path.join(process.cwd(), p));
    for (const file of candidates) {
      TMDB_TOKEN = loadEnvVarFromFile(file, 'TMDB_TOKEN');
      if (TMDB_TOKEN) break;
    }
  }
  if (!TMDB_TOKEN) {
    console.error('Set TMDB_TOKEN (env var or in root .env.local/.env).');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  console.log('Scanning all rating docs via collectionGroup("ratings")...');
  const snap = await db.collectionGroup('ratings').get();
  console.log(`Found ${snap.size} rating doc(s).`);

  let missing = 0;
  for (const d of snap.docs) {
    const data = d.data() || {};
    if (!Array.isArray(data.genres) || data.genres.length === 0) missing += 1;
  }
  console.log(`Docs missing genres: ${missing}`);

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

  const genreCache = new Map(); // `${mediaType}:${mediaId}` -> genres array or null
  const updateBatchSize = 500;

  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};
    if (Array.isArray(data.genres) && data.genres.length > 0) {
      skipped += 1;
      continue;
    }

    const mediaType = data.mediaType;
    const mediaId = data.mediaId != null ? Number(data.mediaId) : null;

    if (!mediaType || !Number.isFinite(mediaId)) {
      console.warn(`Skipping ${d.ref.path}: cannot determine mediaType/mediaId`);
      failed += 1;
      continue;
    }

    const cacheKey = `${mediaType}:${mediaId}`;
    if (!genreCache.has(cacheKey)) {
      const genres = await fetchGenres(mediaType, mediaId);
      genreCache.set(cacheKey, genres);
      if (genres) console.log(`Fetched ${mediaType} ${mediaId}: [${genres.join(', ')}]`);
      else console.warn(`Failed to fetch genres for ${mediaType} ${mediaId}`);
    }

    const genres = genreCache.get(cacheKey);
    if (!genres) {
      failed += 1;
      continue;
    }

    batch.update(d.ref, { genres });
    batchCount += 1;
    updated += 1;

    if (batchCount >= updateBatchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      console.log(`Committed updates so far: ${updated}`);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`Done. Updated: ${updated}, skipped (already had genres): ${skipped}, failed: ${failed}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
