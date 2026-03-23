# Scripts

## migrate-ratings-to-subcollection.js

Moves every user's `ratings` field into a subcollection `users/{userId}/ratings` so user documents stay under Firestore's 1MB limit.

**Before running:**

1. Install dependencies: `npm install`
2. In [Firebase Console](https://console.firebase.google.com) → your project → **Project settings** → **Service accounts** → **Generate new private key**. Save the JSON file somewhere safe (e.g. `./service-account.json` — **do not commit this file**).
3. Set the env var and run once:

   ```bash
   set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
   node scripts/migrate-ratings-to-subcollection.js
   ```

   On macOS/Linux use `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`.

**What it does:**

- Reads each `users/{userId}` document.
- For each user that has a `ratings` object, flattens all entries (movie + tv, all sentiments) into documents in `users/{userId}/ratings` with IDs like `movie_123` or `tv_456_show` / `tv_456_2`.
- Each rating document has: `mediaType`, `sentiment`, `mediaId`, `note`, `score`, `timestamp`, and optionally `season`.
- Removes the `ratings` field from the user document.

**After migration:** Update the app to read and write ratings from `users/{uid}/ratings` (subcollection) instead of the `ratings` field on the user doc.

## inspect-firebase-avatars.js (read-only — run this first)

Lists **Cloud Storage** objects under a prefix (default `avatars/`) and samples **Firestore** `users` docs for `photoURL`, `photoURLSearch`, `photoURLThumb`. Use the output to confirm naming, paths, and fields **before** editing or running `backfill-avatar-resized.js`.

**Prereqs:** `npm install`, `GOOGLE_APPLICATION_CREDENTIALS` set (service account needs Storage read + Firestore read).

**Usage:**

```bash
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
node scripts/inspect-firebase-avatars.js
node scripts/inspect-firebase-avatars.js --all-users
node scripts/inspect-firebase-avatars.js --storage-only
node scripts/inspect-firebase-avatars.js --firestore-only --users=100
```

## backfill-avatar-resized.js

Generates two square JPEGs from each user’s source avatar (`photoURL` and/or Storage `avatars/{uid}/full` or flat `avatars/{uid}`):

- **256×256** → **`avatars/{uid}/search`** → Firestore **`photoURLSearch`** (Explore / search cards)
- **128×128** → **`avatars/{uid}/thumb`** → Firestore **`photoURLThumb`** (smaller UI, e.g. lists)

**Before running:**

1. Run **`inspect-firebase-avatars.js`** and align paths/field names in this script if your bucket layout differs.
2. `npm install` (includes `sharp`).
3. Service account JSON as for other scripts; set `GOOGLE_APPLICATION_CREDENTIALS`.
4. Optional: `FIREBASE_STORAGE_BUCKET=your-project.appspot.com` if the default bucket isn’t resolved.
5. **Deploy Storage rules** from `storage.rules` in the repo root (public read on `avatars/**` so `photoURLSearch` URLs using `?alt=media` without a token work in the browser). In Firebase Console → Storage → Rules, paste and publish, or `firebase deploy --only storage` if your project uses `firebase.json`.

**Usage:**

```bash
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
node scripts/backfill-avatar-resized.js --dry-run
node scripts/backfill-avatar-resized.js --yes
```

Use `--uid=<uid>` for one user, `--force` to regenerate even when both `photoURLSearch` and `photoURLThumb` exist. If only one field is set, the script runs and **writes both** (re-uploads search + thumb for consistency).

## strip-firebase-storage-photo-url-tokens.js

Removes the `token=` query parameter from **Firebase Storage** URLs on `users/{uid}` (default fields: `photoURL`, `photoURLSearch`, `photoURLThumb`). Non-Firebase URLs (e.g. Google profile images) are left unchanged.

**Requires** Storage rules that allow public (or appropriate) read for those paths, or tokenless URLs will 403 in the browser.

**Before running:** `npm install`, service account JSON, `GOOGLE_APPLICATION_CREDENTIALS` set.

**Usage:**

```bash
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
node scripts/strip-firebase-storage-photo-url-tokens.js --dry-run
node scripts/strip-firebase-storage-photo-url-tokens.js --yes
node scripts/strip-firebase-storage-photo-url-tokens.js --uid=<uid> --yes
```

Optional: `--fields=photoURL,photoURLSearch` (comma-separated). `--any-bucket` strips tokens for any `firebasestorage.googleapis.com` URL (default: only buckets matching your project’s default bucket names from the service account / `FIREBASE_STORAGE_BUCKET`).

## reconcile-user-rating-count.js

Sets **`users/{uid}.ratingCount`** to the number of **non-season** ratings: top-level docs under **`users/{uid}/ratings`** whose id starts with **`movie_`** or **`tv_`**. Season ratings are stored under **`tv_{id}/seasons/{n}`** and are not counted (matches app behavior after Details page fixes).

**Usage:**

```bash
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
node scripts/reconcile-user-rating-count.js --dry-run
node scripts/reconcile-user-rating-count.js --yes
node scripts/reconcile-user-rating-count.js --uid=<uid> --yes
```

Logs a warning if any top-level rating doc id does not start with `movie_` or `tv_`.
