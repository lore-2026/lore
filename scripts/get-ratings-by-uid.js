/**
 * Read-only debug script: print ratings for a specific user id.
 *
 * Usage:
 *   node scripts/get-ratings-by-uid.js --uid=<uid>
 *   node scripts/get-ratings-by-uid.js --uid=<uid> --mediaType=movie
 *   node scripts/get-ratings-by-uid.js --uid=<uid> --sentiment=amazing
 *   node scripts/get-ratings-by-uid.js --uid=<uid> --json
 *
 * Prereq:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */
/* eslint-disable no-console */

const admin = require('firebase-admin');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sortByRankThenId(a, b) {
  const aRank = typeof a.score === 'string' ? a.score : '';
  const bRank = typeof b.score === 'string' ? b.score : '';
  if (aRank && bRank && aRank !== bRank) return aRank < bRank ? -1 : 1;
  if (aRank && !bRank) return -1;
  if (!aRank && bRank) return 1;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.');
    process.exit(1);
  }

  const uid = getArg('uid');
  if (!uid) {
    console.error('Missing required --uid=<uid> argument.');
    process.exit(1);
  }

  const mediaTypeFilter = getArg('mediaType'); // movie|tv
  const sentimentFilter = getArg('sentiment');
  const outputJson = hasFlag('json');

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  const snap = await db.collection('users').doc(uid).collection('ratings').get();
  const rows = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      mediaType: data.mediaType || (d.id.startsWith('tv_') ? 'tv' : 'movie'),
      sentiment: data.sentiment || 'good',
      mediaId: data.mediaId ?? null,
      season: data.season ?? null,
      mediaName: data.mediaName ?? null,
      score: data.score ?? null,
      scoreV2: data.scoreV2 ?? null,
      note: data.note ?? null,
      timestamp: data.timestamp ?? null,
      genres: data.genres ?? [],
    };
  });

  const filtered = rows
    .filter((r) => (mediaTypeFilter ? r.mediaType === mediaTypeFilter : true))
    .filter((r) => (sentimentFilter ? r.sentiment === sentimentFilter : true))
    .sort(sortByRankThenId);

  if (outputJson) {
    console.log(JSON.stringify({
      uid,
      totalDocs: rows.length,
      filteredDocs: filtered.length,
      filters: { mediaType: mediaTypeFilter || null, sentiment: sentimentFilter || null },
      ratings: filtered,
    }, null, 2));
    return;
  }

  console.log(`UID: ${uid}`);
  console.log(`Total ratings docs: ${rows.length}`);
  console.log(`After filters: ${filtered.length}`);
  if (mediaTypeFilter || sentimentFilter) {
    console.log(`Filters: mediaType=${mediaTypeFilter || '*'}, sentiment=${sentimentFilter || '*'}`);
  }
  console.log('');

  if (filtered.length === 0) {
    console.log('No ratings found.');
    return;
  }

  filtered.forEach((r, idx) => {
    const seasonLabel = r.season == null ? '' : ` S${r.season}`;
    const name = r.mediaName || `<media:${r.mediaId}>`;
    const genreStr = r.genres.length > 0 ? ` | genres=[${r.genres.join(', ')}]` : '';
    console.log(
      `${String(idx + 1).padStart(3, ' ')}. [${r.mediaType}|${r.sentiment}] ${name}${seasonLabel} | ` +
      `score=${r.score} | id=${r.id}${genreStr}`
    );
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

