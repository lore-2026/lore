/**
 * One-time backfill: write `scoreBasic` (uniform 0–10 within sentiment cohorts)
 * using the same rules as `enrichRatingsWithScoreBasic` in src/lib/ratingsRanking.js.
 *
 * Updates:
 *   1) users/{uid}/ratings/{docId} and nested seasons/{season}
 *   2) mediaRatings/{mediaKey}/userRatings/{uid} and nested seasons/{season}
 *   3) Recomputes mediaRatings/{mediaKey} aggregate fields ratingCount + sumScores
 *
 * Field name in Firestore: `scoreBasic` (not "basicScore").
 *
 * Usage:
 *   node scripts/backfill-scoreBasic.js --yes
 *   node scripts/backfill-scoreBasic.js --uid=<uid> --yes
 *   node scripts/backfill-scoreBasic.js --dry-run
 *   node scripts/backfill-scoreBasic.js --yes --skip-aggregates
 *
 * Prereqs:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */
/* eslint-disable no-console */

const path = require('path');
const { pathToFileURL } = require('url');
const admin = require('firebase-admin');
const readline = require('readline');

const BATCH_SIZE = 500;

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function promptYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = String(answer || '').trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

function entryRefKey(entry) {
  if (entry.mediaType === 'movie') return `movie|${entry.mediaId}|show`;
  return entry.season == null ? `tv|${entry.mediaId}|show` : `tv|${entry.mediaId}|${entry.season}`;
}

async function loadUserRatingsAndRefsAsync(db, uid, snap) {
  const ratings = { movie: {}, tv: {} };
  const refByKey = new Map();

  const pushRating = (entry, userRef, denormRef) => {
    const sentiment = entry.sentiment || 'good';
    const mt = entry.mediaType;
    if (!ratings[mt][sentiment]) ratings[mt][sentiment] = [];
    ratings[mt][sentiment].push(entry);
    refByKey.set(entryRefKey(entry), { userRef, denormRef });
  };

  for (const d of snap.docs) {
    const data = d.data() || {};
    const mediaType = data.mediaType === 'tv' ? 'tv' : 'movie';
    const mediaId = data.mediaId;

    if (mediaType === 'movie') {
      const denormRef = db
        .collection('mediaRatings')
        .doc(`movie_${mediaId}`)
        .collection('userRatings')
        .doc(uid);
      pushRating(
        {
          mediaId,
          mediaType: 'movie',
          mediaName: data.mediaName ?? null,
          note: data.note ?? null,
          score: data.score,
          scoreV2: data.scoreV2 ?? null,
          timestamp: data.timestamp ?? null,
          sentiment: data.sentiment || 'good',
        },
        d.ref,
        denormRef
      );
      continue;
    }

    const denormBase = db.collection('mediaRatings').doc(`tv_${mediaId}`).collection('userRatings').doc(uid);

    pushRating(
      {
        mediaId,
        mediaType: 'tv',
        mediaName: data.mediaName ?? null,
        note: data.note ?? null,
        score: data.score,
        scoreV2: data.scoreV2 ?? null,
        timestamp: data.timestamp ?? null,
        sentiment: data.sentiment || 'good',
      },
      d.ref,
      denormBase
    );

    const seasonsSnap = await d.ref.collection('seasons').get();
    seasonsSnap.forEach((seasonDoc) => {
      const seasonData = seasonDoc.data() || {};
      const season = seasonData.season ?? Number(seasonDoc.id);
      const denormSeason = denormBase.collection('seasons').doc(String(seasonDoc.id));
      pushRating(
        {
          mediaId,
          mediaType: 'tv',
          mediaName: seasonData.mediaName ?? data.mediaName ?? null,
          note: seasonData.note ?? null,
          score: seasonData.score,
          scoreV2: seasonData.scoreV2 ?? null,
          timestamp: seasonData.timestamp ?? null,
          season,
          sentiment: seasonData.sentiment || 'good',
        },
        seasonDoc.ref,
        denormSeason
      );
    });
  }

  return { ratings, refByKey };
}

function flattenEnriched(enriched) {
  const rows = [];
  for (const sentiment of Object.keys(enriched.movie || {})) {
    for (const e of enriched.movie[sentiment] || []) {
      rows.push({ key: entryRefKey(e), scoreBasic: e.scoreBasic });
    }
  }
  for (const sentiment of Object.keys(enriched.tv || {})) {
    for (const e of enriched.tv[sentiment] || []) {
      rows.push({ key: entryRefKey(e), scoreBasic: e.scoreBasic });
    }
  }
  return rows;
}

async function commitBatches(db, updates, dryRun) {
  if (dryRun || updates.length === 0) return;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    const userOps = chunk.filter((u) => u.kind === 'user');
    const denormOps = chunk.filter((u) => u.kind === 'denorm');
    userOps.forEach((u) => {
      batch.update(u.ref, { scoreBasic: u.scoreBasic });
    });
    for (let d = 0; d < denormOps.length; d += 10) {
      const slice = denormOps.slice(d, d + 10);
      const denormRefs = slice.map((u) => u.ref);
      const denormSnaps = await db.getAll(...denormRefs);
      denormSnaps.forEach((snap, idx) => {
        if (snap.exists) {
          batch.update(denormRefs[idx], { scoreBasic: slice[idx].scoreBasic });
        }
      });
    }
    await batch.commit();
  }
}

async function processUser(db, uid, enrichRatingsWithScoreBasic, dryRun) {
  const colRef = db.collection('users').doc(uid).collection('ratings');
  const snap = await colRef.get();
  if (snap.empty) return { ratingDocs: 0, writes: 0 };

  const { ratings, refByKey } = await loadUserRatingsAndRefsAsync(db, uid, snap);
  const enriched = enrichRatingsWithScoreBasic(ratings);
  const rows = flattenEnriched(enriched);

  const updates = [];
  for (const { key, scoreBasic } of rows) {
    const refs = refByKey.get(key);
    if (!refs) {
      console.warn(`Missing ref map for uid=${uid} key=${key}`);
      continue;
    }
    if (typeof scoreBasic !== 'number' || Number.isNaN(scoreBasic)) continue;
    updates.push({ ref: refs.userRef, scoreBasic, kind: 'user' });
    updates.push({ ref: refs.denormRef, scoreBasic, kind: 'denorm' });
  }

  await commitBatches(db, updates, dryRun);
  return { ratingDocs: snap.size, writes: updates.length };
}

async function recomputeMediaAggregates(db, dryRun) {
  const mediaSnap = await db.collection('mediaRatings').get();
  const mediaDocs = mediaSnap.docs;

  const processOne = async (mediaDoc) => {
    const urSnap = await mediaDoc.ref.collection('userRatings').get();
    let sumScores = 0;
    let ratingCount = 0;
    const urs = urSnap.docs;
    const seasonSnaps = await Promise.all(urs.map((ur) => ur.ref.collection('seasons').get()));

    for (let i = 0; i < urs.length; i++) {
      const ur = urs[i];
      const d = ur.data() || {};
      const v =
        typeof d.scoreBasic === 'number'
          ? d.scoreBasic
          : typeof d.score === 'number'
            ? d.score
            : 0;
      sumScores += v;
      ratingCount += 1;
      const seasonsSnap = seasonSnaps[i];
      for (const s of seasonsSnap.docs) {
        const sd = s.data() || {};
        const sv =
          typeof sd.scoreBasic === 'number'
            ? sd.scoreBasic
            : typeof sd.score === 'number'
              ? sd.score
              : 0;
        sumScores += sv;
        ratingCount += 1;
      }
    }
    if (!dryRun) {
      await mediaDoc.ref.set({ ratingCount, sumScores }, { merge: true });
    }
  };

  const CONCURRENCY = 15;
  for (let i = 0; i < mediaDocs.length; i += CONCURRENCY) {
    const slice = mediaDocs.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map((md) => processOne(md)));
    console.log(`  aggregates: ${Math.min(i + CONCURRENCY, mediaDocs.length)}/${mediaDocs.length} media keys`);
  }
  return mediaDocs.length;
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.');
    process.exit(1);
  }

  const onlyUid = getArg('uid');
  const dryRun = hasFlag('dry-run');
  const yes = hasFlag('yes');
  const skipAggregates = hasFlag('skip-aggregates');

  const rankingUrl = pathToFileURL(path.join(__dirname, '../src/lib/ratingsRanking.js')).href;
  const { enrichRatingsWithScoreBasic } = await import(rankingUrl);

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  let userIds;
  if (onlyUid) {
    userIds = [onlyUid];
  } else {
    const usersSnap = await db.collection('users').get();
    userIds = usersSnap.docs.map((d) => d.id);
  }

  console.log(`Users to process: ${userIds.length}${dryRun ? ' (dry-run)' : ''}`);

  if (!yes && !dryRun) {
    const proceed = await promptYesNo('Write scoreBasic to users + mediaRatings? (y/n): ');
    if (!proceed) {
      console.log('Aborted. No changes made.');
      return;
    }
  }

  let totalRatingDocs = 0;
  let totalWrites = 0;

  for (let i = 0; i < userIds.length; i++) {
    const uid = userIds[i];
    const result = await processUser(db, uid, enrichRatingsWithScoreBasic, dryRun);
    totalRatingDocs += result.ratingDocs;
    totalWrites += result.writes;
    if ((i + 1) % 25 === 0 || i === userIds.length - 1) {
      console.log(`Processed ${i + 1}/${userIds.length} users...`);
    }
  }

  console.log(`User phase done.${dryRun ? ' (dry-run: no writes)' : ''}`);
  console.log(`Top-level rating parent docs scanned: ${totalRatingDocs}`);
  console.log(`Field updates queued (user + denorm per rating): ${totalWrites}`);

  if (skipAggregates) {
    console.log('Skipping mediaRatings aggregate recompute (--skip-aggregates).');
  } else {
    console.log('Recomputing mediaRatings/* aggregates (ratingCount, sumScores)...');
    const aggUpdated = await recomputeMediaAggregates(db, dryRun);
    console.log(`Media aggregate docs touched: ${aggUpdated}${dryRun ? ' (dry-run: skipped writes)' : ''}`);
  }

  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
