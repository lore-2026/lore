/**
 * READ-ONLY: Inspect Firebase Storage objects under the avatars prefix and sample
 * Firestore user fields used for profile images. Use this before writing or changing
 * backfill scripts so paths and field names match your project.
 *
 * What it prints:
 *   - Bucket name, optional Storage layout (prefix, file count, sample paths)
 *   - Per-user fields from Firestore: photoURL, photoURLSearch, photoURLThumb (if present)
 *   - Simple pattern counts (e.g. paths ending with _search, _thumb, or "bare" uid)
 *
 * Usage:
 *   node scripts/inspect-firebase-avatars.js
 *   node scripts/inspect-firebase-avatars.js --prefix=avatars/
 *   node scripts/inspect-firebase-avatars.js --max-files=2000
 *   node scripts/inspect-firebase-avatars.js --users=50
 *   node scripts/inspect-firebase-avatars.js --storage-only
 *   node scripts/inspect-firebase-avatars.js --firestore-only
 *   node scripts/inspect-firebase-avatars.js --bucket=my-project.appspot.com
 *   node scripts/inspect-firebase-avatars.js --uid=USER_UID
 *   node scripts/inspect-firebase-avatars.js --all-users
 *
 * Prereq:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   (Service account needs Storage Object Viewer + Cloud Datastore User / Firestore read)
 */
/* eslint-disable no-console */

const fs = require('fs');
const admin = require('firebase-admin');

/** Default bucket when env var unset: derived from service account `project_id`. */
function resolveDefaultBucketName() {
  if (process.env.FIREBASE_STORAGE_BUCKET) return process.env.FIREBASE_STORAGE_BUCKET;
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && fs.existsSync(p)) {
    try {
      const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (sa.project_id) {
        // New projects often use .firebasestorage.app; older ones use .appspot.com
        const legacy = process.env.FIREBASE_STORAGE_BUCKET_LEGACY === '1';
        return legacy ? `${sa.project_id}.appspot.com` : `${sa.project_id}.firebasestorage.app`;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function basename(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function classifyAvatarPath(name) {
  const base = basename(name);
  // Nested layout: avatars/{uid}/search|thumb|full
  if (base === 'search' || /_search$/i.test(base)) return 'suffix_search';
  if (base === 'thumb' || /_thumb$/i.test(base)) return 'suffix_thumb';
  if (base === 'full' || /_full$/i.test(base)) return 'suffix_full';
  // common: avatars/{uid} (flat object, old style)
  return 'bare_or_other';
}

/** Load every user doc (fine for small collections; avoid on huge `users`). */
async function fetchAllUserDocs(usersRef) {
  const snap = await usersRef.get();
  return snap.docs;
}

/** Segments after prefix: flat file `avatars/uid` vs nested `avatars/uid/thumb.jpg`. */
function storageLayoutHint(objectName) {
  const parts = objectName.split('/').filter(Boolean);
  if (parts.length <= 2) return 'flat_file';
  return 'under_folder';
}

async function listAllFiles(bucket, prefix, maxFiles) {
  const out = [];
  let pageToken;
  const pageSize = 1000;
  while (out.length < maxFiles) {
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      maxResults: Math.min(pageSize, maxFiles - out.length),
      pageToken,
      autoPaginate: false,
    });
    for (const f of files) {
      out.push(f);
      if (out.length >= maxFiles) return out;
    }
    pageToken = nextQuery && nextQuery.pageToken;
    if (!pageToken) break;
  }
  return out;
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.');
    process.exit(1);
  }

  const bucketOverride = getArg('bucket');
  const singleUid = getArg('uid');
  const prefix = getArg('prefix') ?? 'avatars/';
  const maxFiles = parsePositiveInt(getArg('max-files'), 5000);
  const userSample = parsePositiveInt(getArg('users'), 30);
  const allUsers = hasFlag('all-users');
  const storageOnly = hasFlag('storage-only');
  const firestoreOnly = hasFlag('firestore-only');

  if (allUsers && getArg('uid')) {
    console.error('Use either --all-users or --uid=, not both.');
    process.exit(1);
  }

  if (storageOnly && firestoreOnly) {
    console.error('Use only one of --storage-only or --firestore-only.');
    process.exit(1);
  }

  const defaultBucket = resolveDefaultBucketName();
  if (!admin.apps.length) {
    const init = { credential: admin.credential.applicationDefault() };
    if (defaultBucket) init.storageBucket = defaultBucket;
    admin.initializeApp(init);
  }

  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    (admin.app().options && admin.app().options.projectId) ||
    '(unknown)';

  console.log('=== Firebase avatar inspection (read-only) ===');
  console.log(`Project: ${projectId}`);
  console.log('');

  if (!firestoreOnly) {
    const bucket =
      bucketOverride != null && bucketOverride !== ''
        ? admin.storage().bucket(bucketOverride)
        : process.env.FIREBASE_STORAGE_BUCKET
          ? admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET)
          : defaultBucket
            ? admin.storage().bucket(defaultBucket)
            : admin.storage().bucket();

    console.log(`Storage bucket: ${bucket.name}`);
    console.log(`Listing prefix: "${prefix}" (max ${maxFiles} objects)`);
    console.log('');

    const files = await listAllFiles(bucket, prefix, maxFiles);
    console.log(`Total objects listed: ${files.length}${files.length >= maxFiles ? ' (hit --max-files cap)' : ''}`);
    console.log('');

    const byClass = { suffix_search: 0, suffix_thumb: 0, suffix_full: 0, bare_or_other: 0 };
    const byLayout = { flat_file: 0, under_folder: 0 };
    for (const f of files) {
      byClass[classifyAvatarPath(f.name)] += 1;
      byLayout[storageLayoutHint(f.name)] += 1;
    }
    console.log('Path pattern counts (basename heuristic):');
    console.log(JSON.stringify(byClass, null, 2));
    console.log('');
    console.log('Layout (flat avatars/<name> vs nested avatars/<folder>/...):');
    console.log(JSON.stringify(byLayout, null, 2));
    console.log('');

    const detail = files.map((f) => ({
      name: f.name,
      layout: storageLayoutHint(f.name),
      size: f.metadata?.size != null ? Number(f.metadata.size) : null,
      contentType: f.metadata?.contentType || null,
      updated: f.metadata?.updated || null,
    }));
    const showAll = files.length <= 100;
    const sample = showAll ? detail : detail.slice(0, 25);
    console.log(showAll ? 'All objects:' : `Sample (first ${sample.length} objects):`);
    console.log(JSON.stringify(sample, null, 2));
    if (!showAll && files.length > sample.length) {
      console.log(`... ${files.length - sample.length} more not shown`);
    }
    console.log('');
  }

  if (!storageOnly) {
    const db = admin.firestore();
    const usersRef = db.collection('users');
    let userDocs;
    if (singleUid) {
      const doc = await usersRef.doc(singleUid).get();
      if (!doc.exists) {
        console.error(`No Firestore user doc for uid: ${singleUid}`);
        process.exit(1);
      }
      userDocs = [doc];
      console.log(`Firestore: single user ${singleUid}`);
    } else if (allUsers) {
      userDocs = await fetchAllUserDocs(usersRef);
      console.log(`Firestore: all user docs (${userDocs.length} total)`);
    } else {
      const snap = await usersRef.limit(userSample).get();
      userDocs = snap.docs;
      console.log(`Firestore sample: first ${userDocs.length} user doc(s) in natural order (limit ${userSample})`);
    }
    console.log('Fields checked: photoURL, photoURLSearch, photoURLThumb, plus firstname/lastname/username');
    console.log('');

    const rows = [];
    for (const doc of userDocs) {
      const d = doc.data() || {};
      rows.push({
        uid: doc.id,
        username: d.username ?? null,
        firstname: d.firstname ?? null,
        lastname: d.lastname ?? null,
        photoURL: d.photoURL ? String(d.photoURL).slice(0, 80) + (String(d.photoURL).length > 80 ? '…' : '') : null,
        hasPhotoURL: !!d.photoURL,
        photoURLSearch: d.photoURLSearch ?? null,
        photoURLThumb: d.photoURLThumb ?? null,
      });
    }
    console.log(JSON.stringify(rows, null, 2));

    let withPhoto = 0;
    let withSearch = 0;
    let withThumb = 0;
    for (const doc of userDocs) {
      const d = doc.data() || {};
      if (d.photoURL) withPhoto += 1;
      if (d.photoURLSearch) withSearch += 1;
      if (d.photoURLThumb) withThumb += 1;
    }
    console.log('');
    console.log(allUsers ? 'Aggregates (full users query):' : 'Sample aggregates (this slice only, not full collection):');
    console.log(
      JSON.stringify(
        {
          withPhotoURL: withPhoto,
          withPhotoURLSearch: withSearch,
          withPhotoURLThumb: withThumb,
        },
        null,
        2
      )
    );
    console.log('');
  }

  console.log('Done. Adjust backfill paths/field names to match what you see above.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
