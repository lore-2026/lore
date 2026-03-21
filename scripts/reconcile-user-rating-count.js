/**
 * Recompute users/{uid}.ratingCount from the ratings subcollection.
 *
 * Counts only **non-season** ratings (same rule as the app):
 *   - one per top-level `movie_{id}` doc
 *   - one per top-level `tv_{mediaId}` doc (whole-show)
 * Season ratings live under `tv_{mediaId}/seasons/{n}` and are NOT counted.
 *
 * Usage:
 *   node scripts/reconcile-user-rating-count.js --dry-run
 *   node scripts/reconcile-user-rating-count.js --yes
 *   node scripts/reconcile-user-rating-count.js --uid=<uid> --yes
 *
 * Prereq:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */
/* eslint-disable no-console */

const admin = require('firebase-admin');
const readline = require('readline');

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

/**
 * @param {FirebaseFirestore.QuerySnapshot} ratingSnap
 * @returns {{ count: number, unknownIds: string[] }}
 */
function countMovieAndShowRatings(ratingSnap) {
  let count = 0;
  const unknownIds = [];
  for (const d of ratingSnap.docs) {
    const id = d.id;
    if (id.startsWith('movie_')) {
      count += 1;
    } else if (id.startsWith('tv_')) {
      count += 1;
    } else {
      unknownIds.push(id);
    }
  }
  return { count, unknownIds };
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.');
    process.exit(1);
  }

  const dryRun = hasFlag('dry-run');
  const yes = hasFlag('yes');
  const singleUid = getArg('uid');

  if (!dryRun && !yes) {
    const proceed = await promptYesNo(
      'Reconcile ratingCount from users/{uid}/ratings (movies + whole-show TV only)? (y/n): '
    );
    if (!proceed) {
      console.log('Aborted. No changes made.');
      return;
    }
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  let usersSnap;
  if (singleUid) {
    const ref = db.collection('users').doc(singleUid);
    const doc = await ref.get();
    usersSnap = { docs: doc.exists ? [doc] : [], size: doc.exists ? 1 : 0 };
    if (!doc.exists) {
      console.error(`No user doc for uid ${singleUid}`);
      process.exit(1);
    }
  } else {
    usersSnap = await db.collection('users').get();
  }

  console.log(`Scanning ${usersSnap.size} user(s).${dryRun ? ' (dry-run)' : ''}\n`);

  let unchanged = 0;
  let updated = 0;
  let warnedUnknown = 0;

  const BATCH_LIMIT = 400;
  let batch = db.batch();
  let batchOps = 0;

  async function commitBatch() {
    if (batchOps === 0) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    batchOps = 0;
  }

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const ratingsSnap = await db.collection('users').doc(uid).collection('ratings').get();
    const { count, unknownIds } = countMovieAndShowRatings(ratingsSnap);

    if (unknownIds.length > 0) {
      warnedUnknown += 1;
      console.warn(`[warn] ${uid}: unexpected top-level rating doc id(s): ${unknownIds.join(', ')}`);
    }

    const data = userDoc.data() || {};
    const current = typeof data.ratingCount === 'number' ? data.ratingCount : null;

    if (current === count) {
      unchanged += 1;
      continue;
    }

    console.log(
      `[${dryRun ? 'would update' : 'update'}] ${uid}: ratingCount ${current === null ? '(missing)' : current} -> ${count}`
    );

    if (!dryRun) {
      batch.update(userDoc.ref, { ratingCount: count });
      batchOps += 1;
      updated += 1;
      if (batchOps >= BATCH_LIMIT) await commitBatch();
    } else {
      updated += 1;
    }
  }

  await commitBatch();

  console.log(
    `\nDone. ${dryRun ? 'Would update' : 'Updated'}: ${updated}, unchanged: ${unchanged}, users with unknown doc ids: ${warnedUnknown}${dryRun ? ' (dry-run)' : ''}`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
