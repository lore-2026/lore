/**
 * One-time backfill: generate square JPEGs for Explore (search) and small UI (thumb),
 * store in Cloud Storage, then set `photoURLSearch` and `photoURLThumb` on each user doc.
 *
 * Sizes:
 *   - search: 256×256 → `avatars/{uid}/search` → field `photoURLSearch`
 *   - thumb:  128×128 → `avatars/{uid}/thumb`  → field `photoURLThumb`
 *
 * Source image (newest wins when both exist):
 *   1) Compare `avatars/{uid}/full` vs `avatars/{uid}` (flat) by Storage `updated` time; use the newer.
 *      The app currently uploads to the flat path; older `full` must not shadow a newer flat upload.
 *   2) If only one exists, use it. When the flat file is newer (or only flat exists), also write that
 *      buffer to `avatars/{uid}/full` so `full` stays in sync.
 *   3) `fetch(photoURL)` only when neither Storage object exists (e.g. Google profile only)
 *
 * Storage paths sit under `avatars/{uid}/` alongside `full`.
 *
 * Usage:
 *   node scripts/backfill-avatar-resized.js --dry-run
 *   node scripts/backfill-avatar-resized.js --yes
 *   node scripts/backfill-avatar-resized.js --uid=<uid> --yes
 *
 * Optional:
 *   --force          Rebuild even if both photoURLSearch and photoURLThumb are set
 *   --bucket=name    Override default Storage bucket (else env FIREBASE_STORAGE_BUCKET or project default)
 *
 * Prereqs:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   npm install   (includes sharp as devDependency)
 *
 * Before running, use scripts/inspect-firebase-avatars.js (read-only) to see your
 * Storage paths and Firestore photo fields so this script matches your project.
 *
 * Storage rules: deploy storage.rules so avatars/* are publicly readable (script stores
 * ?alt=media URLs without a token). See storage.rules in repo root.
 */
/* eslint-disable no-console */

const fs = require('fs');
const admin = require('firebase-admin');
const readline = require('readline');
const sharp = require('sharp');

/** Default Storage bucket from service account JSON (same logic as inspect-firebase-avatars.js). */
function resolveDefaultBucketName() {
  if (process.env.FIREBASE_STORAGE_BUCKET) return process.env.FIREBASE_STORAGE_BUCKET;
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && fs.existsSync(p)) {
    try {
      const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (sa.project_id) {
        const legacy = process.env.FIREBASE_STORAGE_BUCKET_LEGACY === '1';
        return legacy ? `${sa.project_id}.appspot.com` : `${sa.project_id}.firebasestorage.app`;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

/** Explore grid uses ~160px tiles; 256px gives a crisp 2× buffer for retina / layout. */
const SEARCH_SIZE = 256;
/** Smaller avatar for lists, nav-sized crops (~40–96px CSS); 128px covers 2× retina. */
const THUMB_SIZE = 128;
const FIRESTORE_FIELD_SEARCH = 'photoURLSearch';
const FIRESTORE_FIELD_THUMB = 'photoURLThumb';

function searchObjectPath(uid) {
  return `avatars/${uid}/search`;
}

function thumbObjectPath(uid) {
  return `avatars/${uid}/thumb`;
}

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

async function fetchImageBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Prefer reading bytes from our bucket (same as your "full" asset). HTTP fetch is only
 * for users whose photo lives only on an external URL (e.g. lh3.googleusercontent.com).
 */
function storageUpdatedMs(meta) {
  const t = meta?.updated || meta?.timeCreated;
  if (!t) return 0;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Pick source bytes + whether to copy flat → `avatars/{uid}/full` so `full` is not stale.
 */
async function getSourceImageBuffer(bucket, uid, photoURL) {
  const fullPath = `avatars/${uid}/full`;
  const flatPath = `avatars/${uid}`;

  const fullFile = bucket.file(fullPath);
  const flatFile = bucket.file(flatPath);

  const [fullExists] = await fullFile.exists();
  const [flatExists] = await flatFile.exists();

  let chosenFile;
  let chosenPath;
  /** When true, write `buffer` to `avatars/{uid}/full` after we derive search/thumb. */
  let writeFullCopy = false;
  let contentTypeForFullSync = 'image/jpeg';

  if (fullExists && flatExists) {
    const [fullMeta] = await fullFile.getMetadata();
    const [flatMeta] = await flatFile.getMetadata();
    const fullMs = storageUpdatedMs(fullMeta);
    const flatMs = storageUpdatedMs(flatMeta);
    // Tie: prefer flat — matches current client uploads (`avatars/{uid}`).
    if (flatMs >= fullMs) {
      chosenFile = flatFile;
      chosenPath = flatPath;
      writeFullCopy = true;
      if (flatMeta.contentType) contentTypeForFullSync = flatMeta.contentType;
    } else {
      chosenFile = fullFile;
      chosenPath = fullPath;
    }
  } else if (fullExists) {
    chosenFile = fullFile;
    chosenPath = fullPath;
  } else if (flatExists) {
    chosenFile = flatFile;
    chosenPath = flatPath;
    const [flatMeta] = await flatFile.getMetadata();
    if (flatMeta.contentType) contentTypeForFullSync = flatMeta.contentType;
    writeFullCopy = true;
  } else if (photoURL) {
    const buf = await fetchImageBuffer(photoURL);
    return { buffer: buf, source: 'photoURL (HTTP fetch)', writeFullCopy: false, contentTypeForFullSync };
  } else {
    return null;
  }

  const [buf] = await chosenFile.download();
  return { buffer: buf, source: chosenPath, writeFullCopy, contentTypeForFullSync };
}

async function resizeToSquareJpeg(input, size, jpegQuality = 85) {
  return sharp(input)
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();
}

/**
 * Public read URL (no token). Requires Storage rules that allow read for this path
 * (see storage.rules). Manual firebaseStorageDownloadTokens metadata is unreliable
 * from Admin SDK because GCS lowercases custom metadata keys, which can break Firebase
 * token validation → 403 on ?token=.
 */
function buildPublicFirebaseDownloadUrl(bucketName, objectPath) {
  const encoded = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
}

async function uploadJpegWithPublicReadUrl(bucket, objectPath, jpegBuffer) {
  const file = bucket.file(objectPath);
  await file.save(jpegBuffer, {
    resumable: false,
    metadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000',
    },
  });
  return buildPublicFirebaseDownloadUrl(bucket.name, objectPath);
}

/** Keep `avatars/{uid}/full` aligned when the app’s canonical upload is the flat `avatars/{uid}` object. */
async function uploadFullCopyFromSource(bucket, uid, buffer, contentType) {
  const fullPath = `avatars/${uid}/full`;
  const file = bucket.file(fullPath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: contentType || 'image/jpeg',
      cacheControl: 'public, max-age=31536000',
    },
  });
}

async function run() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.');
    process.exit(1);
  }

  const dryRun = hasFlag('dry-run');
  const yes = hasFlag('yes');
  const force = hasFlag('force');
  const singleUid = getArg('uid');
  const bucketOverride = getArg('bucket');

  if (!dryRun && !yes) {
    const proceed = await promptYesNo(
      `Backfill ${FIRESTORE_FIELD_SEARCH} (${SEARCH_SIZE}×${SEARCH_SIZE}) + ${FIRESTORE_FIELD_THUMB} (${THUMB_SIZE}×${THUMB_SIZE}) for users with Storage avatar and/or photoURL? (y/n): `
    );
    if (!proceed) {
      console.log('Aborted. No changes made.');
      return;
    }
  }

  const defaultBucket = resolveDefaultBucketName();
  if (!admin.apps.length) {
    const init = { credential: admin.credential.applicationDefault() };
    if (defaultBucket) init.storageBucket = defaultBucket;
    admin.initializeApp(init);
  }
  const db = admin.firestore();
  const bucket =
    bucketOverride != null && bucketOverride !== ''
      ? admin.storage().bucket(bucketOverride)
      : process.env.FIREBASE_STORAGE_BUCKET
        ? admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET)
        : defaultBucket
          ? admin.storage().bucket(defaultBucket)
          : admin.storage().bucket();

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

  console.log(`Processing ${usersSnap.size} user(s).${dryRun ? ' (dry-run)' : ''}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data() || {};
    const photoURL = typeof data.photoURL === 'string' ? data.photoURL.trim() : '';

    const hasSearch = Boolean(data[FIRESTORE_FIELD_SEARCH]);
    const hasThumb = Boolean(data[FIRESTORE_FIELD_THUMB]);
    if (!force && hasSearch && hasThumb) {
      skipped += 1;
      console.log(
        `[skip] ${uid}: ${FIRESTORE_FIELD_SEARCH} and ${FIRESTORE_FIELD_THUMB} already set (use --force to rebuild)`
      );
      continue;
    }

    try {
      const resolved = await getSourceImageBuffer(bucket, uid, photoURL);
      if (!resolved) {
        skipped += 1;
        console.log(`[skip] ${uid}: no avatars/${uid}/full, no avatars/${uid}, and no photoURL`);
        continue;
      }

      const raw = resolved.buffer;
      const jpegSearch = await resizeToSquareJpeg(raw, SEARCH_SIZE, 85);
      const jpegThumb = await resizeToSquareJpeg(raw, THUMB_SIZE, 82);
      const pathSearch = searchObjectPath(uid);
      const pathThumb = thumbObjectPath(uid);

      if (dryRun) {
        const syncNote = resolved.writeFullCopy ? `; would sync avatars/${uid}/full` : '';
        console.log(
          `[dry-run] ${uid}: source=${resolved.source} → ${pathSearch} (${jpegSearch.length} B) + ${FIRESTORE_FIELD_SEARCH}; ` +
            `${pathThumb} (${jpegThumb.length} B) + ${FIRESTORE_FIELD_THUMB}${syncNote}`
        );
        updated += 1;
        continue;
      }

      if (resolved.writeFullCopy) {
        await uploadFullCopyFromSource(bucket, uid, raw, resolved.contentTypeForFullSync);
      }

      const urlSearch = await uploadJpegWithPublicReadUrl(bucket, pathSearch, jpegSearch);
      const urlThumb = await uploadJpegWithPublicReadUrl(bucket, pathThumb, jpegThumb);
      await db
        .collection('users')
        .doc(uid)
        .set({ [FIRESTORE_FIELD_SEARCH]: urlSearch, [FIRESTORE_FIELD_THUMB]: urlThumb }, { merge: true });
      const syncMsg = resolved.writeFullCopy ? `; synced avatars/${uid}/full` : '';
      console.log(
        `[ok] ${uid}: ${FIRESTORE_FIELD_SEARCH} + ${FIRESTORE_FIELD_THUMB} set (from ${resolved.source})${syncMsg}`
      );
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${uid}:`, err.message || err);
    }
  }

  console.log(`Done. Updated: ${updated}, skipped: ${skipped}, failed: ${failed}${dryRun ? ' (dry-run)' : ''}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
