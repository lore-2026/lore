# Lore — Claude Code Guidelines

## Stack
- **Framework:** Next.js 14 App Router (`'use client'` where needed)
- **Language:** JavaScript (JSX) — no TypeScript
- **Styling:** CSS Modules + CSS Custom Properties
- **Auth/DB:** Firebase Auth + Firestore (project: `lore-f5f5a`)
- **Media data:** TMDB API
- **Icons:** lucide-react + Font Awesome (CDN)
- **Fonts:** Inter (body), Inter Tight (display) — Google Fonts

---

## Design Tokens

All tokens live in **`src/styles/tokens.css`** — imported once via `globals.css`. Never duplicate `:root` blocks elsewhere.

### Colors
```css
/* Surfaces */
--color-surface-default: #141218;
--color-surface-contrast: #1c1b21;
--color-surface-selected: #303039;
--color-surface-hovered: #2b2a33;
--color-surface-inverse: #fefefe;

/* Text */
--color-text-default: #fefefe;
--color-text-secondary: rgba(255, 255, 255, 0.5);
--color-text-inverse: #323233;

/* Icons */
--color-icon-default: #fefefe;
--color-icon-secondary: #ceced2;
--color-icon-tertiary: #6c6c70;

/* Actions */
--color-action-default: #fefefe;
--color-action-hovered: #b6b6b9;

/* Borders */
--color-border-default: #2a2930;
--color-border-secondary: #1e1d24;
--color-border-selected: #58585f;
```

### Spacing (4px base unit)
```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-7: 28px;  --space-8: 32px;  --space-9: 36px;
--space-10: 40px; --space-12: 48px;
```

### Layout
```css
--max-width: 1300px;
--content-max-width: 750px;
--navbar-height: 80px;
--page-padding: 50px;          /* desktop */
--page-padding-mobile: 25px;   /* ≤960px */
```

### Border Radius
```css
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 32px;
```

### Transitions
```css
--transition-fast: all 0.2s ease;
--transition-base: all 0.3s ease;
--transition-slow: all 0.5s ease;
```

### Typography
```css
--font-sans: 'Inter', sans-serif;
--font-tight: 'Inter Tight', sans-serif;
```

---

## Styling Rules

- **Always use `var(--token-name)`** — never hardcode colors, spacing, or font values that exist as tokens.
- **CSS Modules** for all component styles — one `.module.css` per component.
- **Composition via `composes:`** for variant patterns instead of duplicating rules.
- **Single breakpoint:** `@media screen and (max-width: 960px)` for mobile.
- Dark theme is fixed — no light mode support.

### Button Patterns
```css
/* Primary (white fill) */
background: var(--color-surface-inverse);
color: var(--color-text-inverse);
border: none;
/* hover: */ background: var(--color-action-hovered);

/* Secondary (outline) */
border: 1px solid var(--color-border-default);
background: transparent;
color: var(--color-text-default);
/* hover: */ background: var(--color-surface-hovered);
```

### Modal Pattern
Use the generic `Modal` component (`src/components/Modal.jsx`):
```jsx
<Modal
  title="Title"
  onClose={handleClose}
  maxWidth="400px"
  actions={[
    { label: 'Cancel', onClick: handleClose, variant: 'secondary' },
    { label: 'Save', onClick: handleSave, disabled: !canSave },
  ]}
>
  {/* body content */}
</Modal>
```

---

## Component Library (`src/components/`)

| Component | Purpose |
|-----------|---------|
| `Navbar.jsx` | Sticky nav with mobile hamburger |
| `MediaCard.jsx` | Movie/TV card — variants: `explore`, `profile`, `grid` |
| `Modal.jsx` | Generic modal with header, body, CTA actions |
| `ProfileTabs.jsx` | Tabbed content: Lists, Movies, Shows, Watchlist |
| `AddToListModal.jsx` | Add media to watchlist or custom lists |

---

## Routes (`src/app/`)

| Route | Description |
|-------|-------------|
| `/` | Landing — hero carousel + service cards |
| `/login` | Firebase auth |
| `/signup` | Firebase registration |
| `/onboarding` | First-time user setup (username + Letterboxd import) |
| `/explore` | Debounced TMDB search with filter chips |
| `/details?id=&media_type=` | Media details + binary insertion sort rating |
| `/profile` | Current user profile |
| `/user?uid=` | Other user profiles |
| `/list?id=` | Custom list details |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/styles/tokens.css` | Single source of truth for all CSS variables |
| `src/app/globals.css` | Imports tokens, resets, Google Fonts |
| `src/contexts/AuthContext.jsx` | Provides `{ user, initials, photoURL, loading }` |
| `src/lib/firebase.js` | Firebase init |
| `src/lib/tmdb.js` | TMDB helpers + `getPosterUrl(path, size)` |

---

## Icons

lucide-react — import named icons, always pass `size` prop:
```jsx
import { Globe, Lock, Check, X } from 'lucide-react';
<Globe size={14} />
```

Font Awesome via CDN for legacy usage:
```jsx
<i className="fas fa-camera" aria-hidden="true" />
```

---

## Assets (`public/images/`)

| File | Usage |
|------|-------|
| `Rabbit.svg` | Primary app logo |
| `Lore-mobile.svg` | Mobile logo variant |
| `Letterboxd.svg` | Letterboxd brand icon |
| `default-avatar.svg` | Fallback user avatar |
| `placeholder.png` | Generic media placeholder |

TMDB posters loaded via:
```js
import { getPosterUrl } from '../lib/tmdb';
getPosterUrl(posterPath, 'w185'); // w92 | w185 | w342 | w500 | w780 | original
```

---

## Figma → Code Workflow

When implementing a Figma design:

1. **Map colors** to the nearest `--color-*` token — never use raw hex values that exist as tokens.
2. **Map spacing** to `--space-N` — use the closest 4px-unit value.
3. **Use existing components** (`Modal`, `MediaCard`, etc.) before creating new ones.
4. **CSS Modules** — add styles to the relevant `.module.css` file, not inline.
5. **Reuse button patterns** — primary (inverse fill) or secondary (outline) from the patterns above.
6. **Font sizes** — prefer inheriting body size; use explicit sizes only for headings or when Figma specifies a deviation.
7. **Border radius** — use `--radius-sm` (4px), `--radius-md` (8px), or `--radius-lg` (32px). For circular elements use `border-radius: 50%`.

---

---

# iOS Port Architecture Reference

> This section documents the full app architecture for porting Lore to native iOS (Swift/SwiftUI). It covers data models, Firebase operations, TMDB API, the rating algorithm, and every screen's interactions.

---

## Navigation Flow

```
/ (Landing)
├── Guest → /login → Google OAuth
│   ├── New user → /onboarding (Step 1: Profile) → (Step 2: Letterboxd Import) → /explore
│   └── Existing user → /explore
└── Logged-in → /profile

/explore
├── Search: media card → /details?id=X&media_type=Y
├── Search: profile card → /user?uid=Z
└── Trending card → /details?id=X&media_type=Y

/details?id=X&media_type=Y
├── Add to list → AddToListModal
└── Discussion section → /user?uid=FRIENDUID

/profile (current user)
├── ProfileTabs → Lists tab → /list?id=LISTID&uid=UID
├── Followers/Following modal → /user?uid=UID
└── Navbar → /explore, /settings

/user?uid=UID (other user)
├── ProfileTabs → Lists tab → /list?id=LISTID&uid=UID
└── Followers/Following modal → /user?uid=UID

/list?id=LISTID&uid=UID
├── Back → /profile (owner) or /user?uid=UID (viewer)
└── Item tap → /details?id=X&media_type=Y

/settings
├── Data tab → Letterboxd import
└── Dev-only tab → Delete ratings / Delete account
```

---

## Firebase Schema

### Project ID: `lore-f5f5a`

### `users/{uid}`
```
firstname:        string
lastname:         string
fullNameLower:    string          // lowercase "firstname lastname" for search
email:            string
username:         string
photoURL:         string          // Firebase Storage URL or Google photo URL
isDeveloper:      boolean
createdAt:        Timestamp
ratingCount:      number
followerlist:     string[]        // array of uids
followinglist:    string[]        // array of uids
lists: {
  watchlist: [{ mediaId: string, mediaType: "movie"|"tv", timestamp: ISO string }]
}
```

Subcollections:
- `users/{uid}/ratings/{ratingDocId}` — see Rating Entry below
- `users/{uid}/ratings/{tv_id}/seasons/{seasonNum}` — per-season TV rating
- `users/{uid}/customLists/{listId}` — custom lists

### `users/{uid}/ratings/{ratingDocId}`
Rating doc ID format:
- Movie: `movie_{tmdbId}`
- TV whole-show: `tv_{tmdbId}_show` (or `tv_{tmdbId}`)
- TV season: `tv_{tmdbId}_{seasonNum}`

```
mediaType:    "movie" | "tv"
mediaId:      number
mediaName:    string | null
sentiment:    "not-good" | "okay" | "good" | "amazing"
score:        number (1–10, legacy)
scoreV2:      string | null      // lexorank key (current system)
note:         string | null      // user's written review
timestamp:    ISO string
season:       number | null      // only for TV seasons
```

### `users/{uid}/customLists/{listId}`
```
name:         string
description:  string
visibility:   "public" | "private"
items:        [{ mediaId: string, mediaType: "movie"|"tv", timestamp: ISO string }]
createdAt:    Timestamp
```

### `usernames/{username}`
```
uid:  string    // maps username → uid for uniqueness checks
```

### `mediaRatings/{mediaKey}`
`mediaKey` format: `movie_{tmdbId}` or `tv_{tmdbId}`
```
ratingCount:  number
sumScores:    number
// average = sumScores / ratingCount
```

Subcollection: `mediaRatings/{mediaKey}/userRatings/{ratingDocId}`
- Same shape as user rating entry, denormalized for social queries
- TV seasons also get entries: `userRatings/{uid}_s{seasonNum}`

### `mediaDiscussions/{mediaKey}/threads/{threadId}`
```
uid:          string
username:     string
photoURL:     string | null
text:         string (1–2000 chars)
voteCount:    number
upvoterUids:  string[]
replyCount:   number
createdAt:    Timestamp
userScore:    number | null      // author's rating of the media
```

Subcollection: `.../threads/{threadId}/replies/{replyId}`
```
uid:          string
username:     string
photoURL:     string | null
text:         string (1–1000 chars)
voteCount:    number
upvoterUids:  string[]
createdAt:    Timestamp
userScore:    number | null
```

---

## Firebase Operations

### Authentication
- Provider: Google OAuth (`signInWithPopup` / `signInWithRedirect` on mobile)
- On sign-in: check `users/{uid}` exists → if no `username` field, route to onboarding
- `onAuthStateChanged` listener provides current user state throughout app
- Sign out: `signOut(auth)`

### User Profile — Reads
```
getDoc("users/{uid}")                     // profile data, watchlist, follower arrays
getDocs("users/{uid}/customLists")        // all custom lists (filter by visibility for non-owners)
```

### User Profile — Writes
```
// Create user on first login
setDoc("users/{uid}", { firstname, lastname, fullNameLower, email, photoURL, username,
                        isDeveloper: false, createdAt, lists: { watchlist: [] } })

// Create username index entry (batch with user doc)
setDoc("usernames/{username}", { uid })

// Update username (atomic batch)
batch.set("usernames/{newUsername}", { uid })
batch.update("users/{uid}", { username: newUsername })
batch.delete("usernames/{oldUsername}")

// Update avatar
uploadBytes(storage, "avatars/{uid}", file) → getDownloadURL() → update("users/{uid}", { photoURL })

// Edit username (same batch pattern as above)
```

### Ratings — Reads
```
getDocs("users/{uid}/ratings")                      // all user ratings
getDoc("users/{uid}/ratings/{ratingDocId}")         // single rating
getDocs("users/{uid}/ratings/{tv_id}/seasons")      // all seasons for a show
getDoc("mediaRatings/{mediaKey}")                   // aggregate average
getDocs("mediaRatings/{mediaKey}/userRatings",
  where("uid", "in", [friendUids]))                // friends' ratings for a media
```

### Ratings — Writes
```
// Save/update rating
setDoc("users/{uid}/ratings/{ratingDocId}", ratingEntry)
setDoc("mediaRatings/{mediaKey}/userRatings/{uid}_show", ratingEntry)   // denormalized
updateDoc("users/{uid}", { ratingCount: increment(1) })
updateDoc("mediaRatings/{mediaKey}", { ratingCount: increment(1), sumScores: increment(score) })

// TV season
setDoc("users/{uid}/ratings/{tv_id}/seasons/{season}", seasonEntry)
setDoc("mediaRatings/{mediaKey}/userRatings/{uid}_s{season}", seasonEntry)

// Delete rating
deleteDoc("users/{uid}/ratings/{ratingDocId}")
deleteDoc("mediaRatings/{mediaKey}/userRatings/{ratingDocId}")
updateDoc("users/{uid}", { ratingCount: increment(-1) })
// Recalculate aggregate (fetch remaining, resum)
```

### Social — Follow/Unfollow
```
// Follow
updateDoc("users/{currentUid}", { followinglist: arrayUnion(targetUid) })
updateDoc("users/{targetUid}",  { followerlist:  arrayUnion(currentUid) })

// Unfollow
updateDoc("users/{currentUid}", { followinglist: arrayRemove(targetUid) })
updateDoc("users/{targetUid}",  { followerlist:  arrayRemove(currentUid) })
```

### Watchlist
```
// Add/remove item
setDoc("users/{uid}", { lists: { watchlist: [...updatedArray] } }, { merge: true })
```

### Custom Lists
```
// Create
addDoc("users/{uid}/customLists", { name, description, visibility, items: [], createdAt })

// Update metadata
updateDoc("users/{uid}/customLists/{listId}", { name, description, visibility })

// Add/remove item
updateDoc("users/{uid}/customLists/{listId}", { items: [...updatedItems] })

// Delete
deleteDoc("users/{uid}/customLists/{listId}")
```

### User Search (Explore)
```
// By username prefix
query("users", orderBy("username"), where("username", ">=", q), where("username", "<=", q+"\uf8ff"), limit(10))

// By full name prefix
query("users", orderBy("fullNameLower"), where("fullNameLower", ">=", q), where("fullNameLower", "<=", q+"\uf8ff"), limit(10))
```

### Discussions
```
// Friends tab
query(threads, where("uid", "in", [me, ...following]), orderBy("createdAt", "desc"), limit(20))

// All tab
query(threads, orderBy("voteCount", "desc"), limit(20))

// Post thread
addDoc("mediaDiscussions/{mediaKey}/threads", { uid, username, photoURL, text, voteCount: 0,
                                                upvoterUids: [], replyCount: 0, createdAt, userScore })

// Edit thread
updateDoc(".../threads/{id}", { text })

// Delete thread
deleteDoc(".../threads/{id}")

// Upvote thread
updateDoc(".../threads/{id}", { voteCount: increment(±1), upvoterUids: arrayUnion/arrayRemove(uid) })

// Post reply
addDoc(".../threads/{id}/replies", { uid, username, photoURL, text, voteCount: 0, upvoterUids: [], createdAt, userScore })
updateDoc(".../threads/{id}", { replyCount: increment(1) })

// Same edit/delete/upvote ops apply to replies
```

---

## TMDB API

Base URL: `https://api.themoviedb.org/3`
Auth: `Authorization: Bearer {TMDB_API_KEY}` header
Image base: `https://image.tmdb.org/t/p/{size}{poster_path}`
Image sizes: `w92`, `w185`, `w342`, `w500`, `w780`, `original`

### Endpoints Used

#### Search
```
GET /search/multi?query={q}&include_adult=false
  → results[].{id, media_type, title|name, poster_path, release_date|first_air_date, genre_ids, overview}
  Filter: only media_type "movie" or "tv"

GET /search/movie?query={q}&primary_release_year={year}
  → results[].{id, title, release_date, poster_path}
  Used for Letterboxd import (exact movie matching)
```

#### Details
```
GET /movie/{id}?append_to_response=credits
  → { id, title, overview, poster_path, release_date, runtime, genres[{name}],
      credits: { cast[{name, character, profile_path}] } }

GET /tv/{id}?append_to_response=credits
  → { id, name, overview, poster_path, first_air_date, number_of_seasons,
      seasons[{season_number, name, episode_count}],
      genres[{name}], credits: { cast[...] } }
```

#### Trending
```
GET /trending/movie/week   → results[].{id, title, poster_path, ...}
GET /trending/tv/week      → results[].{id, name, poster_path, ...}
```

#### Popular (Landing page)
```
GET /movie/popular         → results[0..9] (10 movies)
GET /tv/popular            → results[0..9] (10 shows)
Shuffled together for hero carousel
```

---

## Rating Algorithm

### Sentiment Buckets
| Sentiment | Score Range |
|-----------|-------------|
| `not-good` | 1–3 |
| `okay` | 4–6 |
| `good` | 7–8 |
| `amazing` | 9–10 |

### Rank Keys (LexoRank)
- Each rating has a `scoreV2` field: a 12-character lexicographic key (alphabet `0-9A-Za-z`)
- Lower key = higher rank (best items have small keys within their sentiment group)
- Insertion: generate a key between neighbors with `keyBetween(left, right)`
- When no space exists between neighbors: rebalance the entire group with evenly-spaced keys
- Keys are per-sentiment-group; a "good" item's key has no relation to a "not-good" item's key

### Display Score Derivation (Movies)
```
position = index in sorted list (0 = best)
total = count in sentiment group
ratio = position / max(total - 1, 1)        // 0.0 (best) → 1.0 (worst)
score = maxOfRange - ratio * (maxOfRange - minOfRange)
// E.g. "good" group (7–8): best item → 8.0, worst → 7.0
```

### Display Score Derivation (TV)
Whole shows are ranked independently per sentiment group (same as movies).
Seasons for a show are anchored to their parent show's score with small offsets:
```
Season offsets by sentiment:
  "not-good": -1.2
  "okay":     -0.6
  "good":      0.0
  "amazing":  +0.3
Seasons in the same show get ±0.1 deltas to avoid score collisions.
```

### Binary Insertion Sort UI (Details page)
When a user rates a new item, the app compares it against existing items in the same sentiment:
1. Start with the median item as the first comparison
2. User picks which they like more → narrows the insertion point
3. Repeat (binary search) until the position is determined
4. Generate a lexorank key between the neighbors at the insertion point
5. Minimum 1 comparison required; can skip to insert at current low position

---

## Screen Reference

### Landing (`/`)
**Purpose:** Marketing page, hero carousel
**Interactables:**
- Draggable movie poster cards (Framer Motion)
- "Start ranking free" → `/signup` (guests) or "Go to profile" → `/profile` (logged in)
**Data:**
- Read `users` count via `getCountFromServer()`
- TMDB: `getPopularMedia()` → 20 mixed movies/shows shuffled

---

### Login (`/login`)
**Purpose:** Google OAuth sign-in
**Interactables:**
- "Continue with Google" button → `signInWithPopup(googleProvider)`
- Error message display
**Post-login routing:**
- No `users/{uid}` doc → `/onboarding`
- Doc exists, no `username` → `/onboarding`
- Doc exists with `username` → `/explore`

---

### Onboarding (`/onboarding`)
**Purpose:** Two-step first-time user setup
**Step 1 — Profile:**
- Avatar upload: click to pick image (optional)
- Username text field: 3–20 chars, `/^[a-zA-Z0-9_]{3,20}$/`
- Real-time username availability check against `usernames/{username}`
- "Continue" button (disabled until valid username)
- Atomic batch write: `users/{uid}` + `usernames/{username}`

**Step 2 — Letterboxd Import:**
- Folder/file picker for Letterboxd export ZIP or folder
- Requires `ratings.csv` in the export
- "Import" button → parses CSV, searches TMDB per title, saves ratings
- Progress bar with real-time count
- "Or, start fresh in Lore" link → skip to `/explore`
- On complete → `/explore`

---

### Explore (`/explore`)
**Purpose:** Search movies, shows, and user profiles; browse trending
**Interactables:**
- Search input (debounced 300ms)
- Filter chips: "All" | "Movies" | "TV shows" | "Profiles"
- Media card tap → `/details?id=X&media_type=Y`
- Media card "+" button → AddToListModal
- Profile card tap → `/user?uid=Z`
**Data:**
- TMDB `searchMedia(query)` for media results
- Firestore prefix queries on `users` collection for profile results
- TMDB `getTrendingMovies()` + `getTrendingShows()` when no search query
- Read `users/{uid}.lists.watchlist` to show watchlist state on cards

---

### Details (`/details?id=&media_type=`)
**Purpose:** Full media page — metadata, rating, social, discussions
**Interactables:**

*Pre-rating:*
- TV: season selector dropdown ("All" or Season 1–N)
- Sentiment picker: 4 buttons ("Not good" / "Okay" / "Good" / "Amazing")
- Note textarea (optional review text)
- "Next" → starts comparison phase or saves as first rating

*Comparison phase (binary insertion sort):*
- Two large comparison cards: "Which did you like more?"
- "Skip" button → inserts at current low position
- Progress indicator

*Existing rating:*
- Your score display box
- "Re-rank" button → restart comparison for this item
- "Delete rating" button → confirmation, then delete
- Friends' average score (from `mediaRatings`)
- TV breakdown table: rows per season + whole show
  - Each row: your score | friends avg | community avg
  - Friends score cell → dropdown with friend avatars + individual scores
  - Re-rank / delete icons per row
- "Rate another season" button (TV only)

*Always visible:*
- Movie poster with "+" overlay → AddToListModal
- Title, year, overview, genres, cast
- Discussion section (if user has rated)

**Data:**
- TMDB `fetchMediaDetails(mediaType, id)`
- Read `users/{uid}/ratings/{mediaKey}` (and seasons)
- Read `users/{uid}.followinglist`
- Read `mediaRatings/{mediaKey}/userRatings` (friends' scores)
- Read `mediaRatings/{mediaKey}` (community average)
- Read/write `mediaDiscussions/{mediaKey}/threads`
- Write rating entry on save; delete on remove

---

### Profile (`/profile`)
**Purpose:** Current user's profile and settings
**Interactables:**
- Avatar: tap to upload new photo → Firebase Storage
- Username edit button → modal with text field + save/cancel
- "Share" button → copies `https://lore.app/user?uid={uid}` to clipboard
- Stats row: "Ratings" count, "Followers" count (tap → followers modal), "Following" count (tap → following modal)
- Followers/Following modal: list of users, tap to navigate to `/user?uid=Z`
- ProfileTabs: Lists | Movies | Shows | Watchlist
  - Lists tab: tap list → `/list?id=X&uid=Y`; "New list" button → create modal
  - Movies/Shows tab: grid of rated items, tap → `/details`
  - Watchlist tab: filter chips (All/Movies/Shows), tap item → `/details`, remove button

**Data:**
- Read `users/{uid}` on load
- Read follower/following user docs for modal display
- ProfileTabs loads ratings via `getRatings(uid)`

---

### User Profile (`/user?uid=`)
**Purpose:** View another user's public profile
**Interactables:**
- "Follow" / "Unfollow" button (hidden if viewing own profile)
- "Share" button → copies profile URL
- Stats row + Followers/Following modals (same as /profile)
- ProfileTabs (read-only; private lists hidden)

**Data:**
- Read `users/{targetUid}` + `users/{currentUid}` (to check follow status)
- Follow/Unfollow: dual `arrayUnion`/`arrayRemove` on both user docs

---

### List (`/list?id=&uid=`)
**Purpose:** View a custom list or watchlist
**Interactables (owner only):**
- Edit button → modal: name field, description field, visibility toggle (Public/Private)
- Delete button → confirmation modal → `deleteDoc`
- Remove item icon on each card
- Share button → copies list URL

**All users:**
- Tap media card → `/details?id=X&media_type=Y`
- "Back" button → `/profile` (owner) or `/user?uid=UID` (viewer)

**Data:**
- Read `users/{uid}/customLists/{listId}`
- TMDB `fetchMediaDetails()` for each item (enrich with title, poster, year)
- Writes: edit metadata, remove item, delete list

---

### Settings (`/settings`)
**Purpose:** Account and data management
**Tabs:**
- **Account:** Placeholder (no interactions yet)
- **Data — Letterboxd Import:**
  - Folder/file picker
  - "Import" button with real-time progress
  - Result summary: successful / skipped / failed counts
  - "View import summary" modal with per-title details
  - "Re-import" button
- **Dev-only** (isDeveloper === true):
  - "Delete all ratings" → confirmation modal → `deleteAllRatings(uid)`
  - "Delete account" → confirmation modal → delete all data + `signOut()`

---

## Component Reference (Web → iOS equivalents)

| Web Component | Purpose | iOS Equivalent |
|---------------|---------|----------------|
| `Navbar` | Top navigation, user menu | `NavigationView` + toolbar |
| `Modal` | Generic dialog | `sheet` or `.alert` |
| `MediaCard` | Movie/TV tile with poster | Custom `View` with `AsyncImage` |
| `ProfileTabs` | Tabbed profile content | `TabView` |
| `AddToListModal` | Add item to watchlist/lists | Sheet with list of toggles |
| `EmptyState` | Empty content placeholder | Custom centered `VStack` |
| `Toast` | Auto-dismiss notification | Custom overlay or `.overlay` |
| `ImportStatusPopup` | Floating import progress card | Custom overlay `View` |
| `DiscussionSection` | Threaded comments | `List` with nested replies |

---

## Context Providers (State Management)

### Auth State
Provided by: `AuthContext` (web) → use Firebase `Auth.auth().currentUser` + listener on iOS
Shape:
```swift
struct AppUser {
  let uid: String
  let email: String
  let firstname: String
  let lastname: String
  let initials: String       // derived: first char of first + last name
  var photoURL: String?
  var username: String?
}
```

### Ratings Cache
Provided by: `RatingsContext` (web)
Purpose: Avoid re-fetching ratings on every page. Cache the full ratings map after first load.
Refresh on: after Letterboxd import, after rating/deleting an item.

### Import Status
Provided by: `ImportStatusContext` (web)
Purpose: Track Letterboxd import progress across screen transitions.
State: `idle | running | done | error` with counts (total, processed, successful, skipped, failed)
Persist to: `UserDefaults` on iOS (equivalent of `localStorage`)

---

## Firestore Security Rules Summary

| Collection | Read | Write |
|---|---|---|
| `users/{uid}` | Any authenticated user | Owner only (except `followerlist` — anyone can update) |
| `users/{uid}/ratings/**` | Any authenticated user | Owner only |
| `users/{uid}/customLists/**` | Any authenticated user | Owner only |
| `usernames/{username}` | Any authenticated user | Any authenticated user |
| `mediaRatings/**` | Any authenticated user | Any authenticated user |
| `mediaDiscussions/.../threads` | Any authenticated user | Create: auth required, uid must match; Update: owner (any field) or anyone (voteCount/replyCount); Delete: owner |
| `.../threads/.../replies` | Any authenticated user | Create: auth required, uid must match; Update: owner or anyone (voteCount); Delete: owner |
