/**
 * Strip `token` query params from Firebase Storage download URLs stored on user docs.
 *
 * `getDownloadURL()` URLs look like:
 *   https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=...
 * This script rewrites them to tokenless URLs (requires Storage rules that allow read):
 *   https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media
 *
 * Skips non-Firebase URLs (e.g. lh3.googleusercontent.com). By default only edits URLs
 * whose bucket matches your project default bucket(s) from the service account JSON.
 *
 * Usage:
 *   node scripts/strip-firebase-storage-photo-url-tokens.js --dry-run
 *   node scripts/strip-firebase-storage-photo-url-tokens.js --yes
 *   node scripts/strip-firebase-storage-photo-url-tokens.js --uid=<uid> --yes
 *
 * Optional:
 *   --fields=photoURL,photoURLSearch,photoURLThumb   (comma-separated; defaults to these three)
 *   --any-bucket                                     strip tokens for any firebasestorage.googleapis.com URL (use with care)
 *
 * Prereq:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */
/* eslint-disable no-console */

const fs = require('fs');
const admin = require('firebase-admin');
const readline = require('readline');

const DEFAULT_FIELDS = ['photoURL', 'photoURLSearch', 'photoURLThumb'];

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

/** Buckets we consider "this project" (both legacy and default suffixes). */
function resolveAllowedBuckets() {
  const out = new Set();
  if (process.env.FIREBASE_STORAGE_BUCKET) {
    out.add(process.env.FIREBASE_STORAGE_BUCKET.trim());
  }
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && fs.existsSync(p)) {
    try {
      const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (sa.project_id) {
        out.add(`${sa.project_id}.appspot.com`);
        out.add(`${sa.project_id}.firebasestorage.app`);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return [...out];
}

function extractBucketFromFirebaseStorageUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.hostname !== 'firebasestorage.googleapis.com') return null;
    const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ changed: boolean, url: string }}
 */
function stripTokenFromFirebaseStorageUrl(urlString) {
  if (typeof urlString !== 'string') return { changed: false, url: urlString };
  const trimmed = urlString.trim();
  if (!trimmed.includes('firebasestorage.googleapis.com')) {
    return { changed: false, url: trimmed };
  }
  try {
    const u = new URL(trimmed);
    if (!u.searchParams.has('token')) {
      return { changed: false, url: trimmed };
    }
    u.searchParams.delete('token');
    if (!u.searchParams.has('alt')) {
      u.searchParams.set('alt', 'media');
    }
    const next = u.toString();
    return { changed: next !== trimmed, url: next };
  } catch {
    return { changed: false, url: trimmed };
  }
}

function parseFieldsArg() {
  const raw = getArg('fields');
  if (!raw || !raw.trim()) return DEFAULT_FIELDS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.');
    process.exit(1);
  }

  const dryRun = hasFlag('dry-run');
  const yes = hasFlag('yes');
  const singleUid = getArg('uid');
  const anyBucket = hasFlag('any-bucket');
  const fields = parseFieldsArg();

  const allowedBuckets = resolveAllowedBuckets();
  if (!anyBucket && allowedBuckets.length === 0) {
    console.error(
      'Could not resolve default Storage bucket(s). Set FIREBASE_STORAGE_BUCKET or use a valid service account JSON, or pass --any-bucket.'
    );
    process.exit(1);
  }

  if (!dryRun && !yes) {
    const proceed = await promptYesNo(
      `Strip Firebase Storage tokens from [${fields.join(', ')}] on users/*? (y/n): `
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

  console.log(`Fields: ${fields.join(', ')}`);
  console.log(
    anyBucket
      ? 'Bucket filter: OFF (--any-bucket)'
      : `Bucket allowlist: ${allowedBuckets.join(', ')}`
  );
  console.log(`Mode: ${dryRun ? 'dry-run' : 'WRITE'}\n`);

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

  let skipped = 0;
  let touchedDocs = 0;

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
    const data = userDoc.data() || {};
    const patch = {};

    for (const field of fields) {
      const val = data[field];
      if (typeof val !== 'string' || !val.trim()) continue;

      if (!val.includes('firebasestorage.googleapis.com')) continue;
      if (!anyBucket) {
        const b = extractBucketFromFirebaseStorageUrl(val);
        if (!b || !allowedBuckets.includes(b)) {
          continue;
        }
      }

      const { changed, url } = stripTokenFromFirebaseStorageUrl(val);
      if (changed) {
        patch[field] = url;
      }
    }

    if (Object.keys(patch).length === 0) {
      skipped += 1;
      continue;
    }

    touchedDocs += 1;
    const uid = userDoc.id;
    console.log(
      `[${dryRun ? 'dry-run' : 'update'}] ${uid}: ${Object.entries(patch)
        .map(([k, v]) => `${k} → ${String(v).slice(0, 72)}${String(v).length > 72 ? '…' : ''}`)
        .join('; ')}`
    );

    if (!dryRun) {
      batch.update(userDoc.ref, patch);
      batchOps += 1;
      if (batchOps >= BATCH_LIMIT) await commitBatch();
    }
  }

  await commitBatch();

  console.log(
    `\nDone. Docs ${dryRun ? 'that would be ' : ''}updated: ${touchedDocs}, user docs scanned: ${usersSnap.size}, unchanged: ${skipped}${dryRun ? ' (dry-run)' : ''}`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
