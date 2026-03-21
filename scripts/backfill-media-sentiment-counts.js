/**
 * One-time backfill: set sentimentCounts on each mediaRatings/{mediaKey} by scanning
 * all top-level user rating docs (movies + whole-show TV only; season ratings excluded).
 *
 * ## How sentiment is stored (same as app: src/lib/ratingsFirestore.js)
 *
 * Document path:
 *   mediaRatings/{mediaKey}
 *   where mediaKey is "movie_{tmdbId}" or "tv_{tmdbId}"
 *
 * Field:
 *   sentimentCounts — map with numeric keys (no hyphens in Firestore field names):
 *     notGood   — count of ratings with sentiment "not-good"
 *     okay
 *     good
 *     amazing
 *
 * Also removes legacy fields from every mediaRatings doc (this script only touches
 * the mediaRatings collection, not users):
 *   ratingCount — deleted
 *   sumScores     — deleted
 *
 * Source of truth for this script:
 *   users/{uid}/ratings/{docId}
 *   Only documents in the "ratings" subcollection (not seasons/*) are read.
 *   Season ratings live under users/.../ratings/tv_{id}/seasons/{n} and are ignored.
 *
 * Doc ID shapes handled:
 *   movie_{id}
 *   tv_{id}              — whole-show (current app path)
 *   tv_{id}_show         — whole-show (alternate)
 *   tv_{id}_{n} or tv_{id}_s{n} — legacy flat season at top level (skipped for sentiment)
 *
 * Usage (from repo root):
 *   node scripts/backfill-media-sentiment-counts.js --dry-run
 *   node scripts/backfill-media-sentiment-counts.js --yes
 *
 * Credentials (first match wins):
 *   --credentials=./service-account.json
 *   GOOGLE_APPLICATION_CREDENTIALS
 *   ./service-account.json in the current working directory
 *
 * Options:
 *   --dry-run   Log counts only, no writes
 *   --yes       Required to write (after dry-run review)
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function resolveCredentialsPath() {
  const explicit = getArg('credentials');
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const rootDefault = path.join(process.cwd(), 'service-account.json');
  if (fs.existsSync(rootDefault)) {
    return rootDefault;
  }
  return null;
}

const SENTIMENT_TO_FIELD = {
  'not-good': 'notGood',
  okay: 'okay',
  good: 'good',
  amazing: 'amazing',
};

function normalizeSentiment(s) {
  const key = s && typeof s === 'string' ? s : 'good';
  return SENTIMENT_TO_FIELD[key] ? key : 'good';
}

function sentimentToFirestoreKey(sentiment) {
  return SENTIMENT_TO_FIELD[normalizeSentiment(sentiment)];
}

/**
 * @returns {{ mediaKey: string } | null} null = skip (unknown id or season-only top-level)
 */
function parseTopLevelRatingDocId(docId) {
  if (typeof docId !== 'string') return null;

  if (docId.startsWith('movie_')) {
    const id = Number(docId.slice('movie_'.length));
    if (!Number.isFinite(id)) return null;
    return { mediaKey: `movie_${id}` };
  }

  if (!docId.startsWith('tv_')) return null;

  let m = /^tv_(\d+)_show$/.exec(docId);
  if (m) return { mediaKey: `tv_${m[1]}` };

  m = /^tv_(\d+)$/.exec(docId);
  if (m) return { mediaKey: `tv_${m[1]}` };

  // Legacy flat season: tv_123_2 or tv_123_s2 — do not count toward community sentiment
  m = /^tv_(\d+)_(s\d+|\d+)$/.exec(docId);
  if (m) return null;

  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function run() {
  const credPath = resolveCredentialsPath();
  if (!credPath || !fs.existsSync(credPath)) {
    console.error(
      'Could not find credentials. Use --credentials=./service-account.json, set GOOGLE_APPLICATION_CREDENTIALS, or place service-account.json in the project root.'
    );
    process.exit(1);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  console.log(`Using credentials: ${credPath}\n`);

  const dryRun = hasFlag('dry-run');
  const yes = hasFlag('yes');

  if (!dryRun && !yes) {
    console.error('Pass --dry-run to preview, or --yes to write. Refusing to run with no flag.');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log('Scanning collection group "ratings" (top-level user rating docs only)...\n');

  const snap = await db.collectionGroup('ratings').get();

  /** @type {Map<string, { notGood: number, okay: number, good: number, amazing: number }>} */
  const byMediaKey = new Map();

  let skippedUnknown = 0;
  let skippedSeasonShape = 0;
  let processed = 0;

  snap.docs.forEach((d) => {
    const parts = d.ref.path.split('/');
    // users/{uid}/ratings/{docId}
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'ratings') {
      return;
    }

    const docId = parts[3];
    const parsed = parseTopLevelRatingDocId(docId);
    if (parsed === null) {
      if (docId.startsWith('tv_')) {
        skippedSeasonShape += 1;
      } else {
        skippedUnknown += 1;
      }
      return;
    }

    const data = d.data() || {};
    const fieldKey = sentimentToFirestoreKey(data.sentiment);
    if (!byMediaKey.has(parsed.mediaKey)) {
      byMediaKey.set(parsed.mediaKey, {
        notGood: 0,
        okay: 0,
        good: 0,
        amazing: 0,
      });
    }
    const agg = byMediaKey.get(parsed.mediaKey);
    agg[fieldKey] += 1;
    processed += 1;
  });

  console.log(`Top-level rating docs counted: ${processed}`);
  console.log(`Skipped (legacy flat season doc ids): ${skippedSeasonShape}`);
  console.log(`Skipped (unknown doc id shape): ${skippedUnknown}`);
  console.log(`Unique mediaKey aggregates: ${byMediaKey.size}\n`);

  if (dryRun) {
    console.log('[dry-run] No writes. Sample (first 15 media keys):');
    let i = 0;
    for (const [mediaKey, counts] of byMediaKey) {
      if (i++ >= 15) break;
      console.log(`  ${mediaKey}:`, counts);
    }
    console.log('\nRun with --yes to write mediaRatings (sentimentCounts + remove legacy fields).');
    return;
  }

  const allMediaSnap = await db.collection('mediaRatings').get();
  const existingIds = new Set(allMediaSnap.docs.map((d) => d.id));
  console.log(`mediaRatings parent documents: ${allMediaSnap.size}`);

  const operations = [];

  for (const d of allMediaSnap.docs) {
    const counts = byMediaKey.get(d.id);
    if (counts) {
      operations.push({ ref: d.ref, op: 'setCounts', counts });
    } else {
      operations.push({ ref: d.ref, op: 'stripLegacy' });
    }
  }

  for (const mediaKey of byMediaKey.keys()) {
    if (existingIds.has(mediaKey)) continue;
    const counts = byMediaKey.get(mediaKey);
    operations.push({
      ref: db.collection('mediaRatings').doc(mediaKey),
      op: 'newCounts',
      counts,
    });
  }

  for (let i = 0; i < operations.length; i += 500) {
    const batch = db.batch();
    const chunk = operations.slice(i, i + 500);
    for (const op of chunk) {
      if (op.op === 'setCounts') {
        batch.set(
          op.ref,
          {
            sentimentCounts: {
              notGood: op.counts.notGood,
              okay: op.counts.okay,
              good: op.counts.good,
              amazing: op.counts.amazing,
            },
            ratingCount: FieldValue.delete(),
            sumScores: FieldValue.delete(),
          },
          { merge: true }
        );
      } else if (op.op === 'stripLegacy') {
        batch.update(op.ref, {
          ratingCount: FieldValue.delete(),
          sumScores: FieldValue.delete(),
        });
      } else {
        batch.set(
          op.ref,
          {
            sentimentCounts: {
              notGood: op.counts.notGood,
              okay: op.counts.okay,
              good: op.counts.good,
              amazing: op.counts.amazing,
            },
          },
          { merge: true }
        );
      }
    }
    await batch.commit();
    console.log(`Committed ${Math.min(i + chunk.length, operations.length)} / ${operations.length} writes...`);
  }

  console.log(
    `\nDone. ${operations.length} mediaRatings write(s): sentimentCounts from user ratings; ratingCount + sumScores stripped on existing docs.`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
