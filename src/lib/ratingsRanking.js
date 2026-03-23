const SCORE_RANGES = {
  'not-good': [1, 3],
  okay: [4, 6],
  good: [7, 8],
  amazing: [9, 10],
};

const SEASON_SENTIMENT_OFFSETS = {
  'not-good': -1.2,
  okay: -0.6,
  good: 0,
  amazing: 0.3,
};

// Keep seasonal score deltas modest so seasons stay near the whole-show anchor.
const SEASON_RANK_SPREAD = 0.1;

function clampScore(value) {
  return Math.max(1, Math.min(10, Math.round(value * 10) / 10));
}

export function sortRatingsByRank(a, b) {
  const aRank = typeof a.score === 'string' ? a.score : (typeof a.scoreV2 === 'string' ? a.scoreV2 : null);
  const bRank = typeof b.score === 'string' ? b.score : (typeof b.scoreV2 === 'string' ? b.scoreV2 : null);
  if (aRank && bRank) {
    if (aRank < bRank) return -1;
    if (aRank > bRank) return 1;
  } else if (aRank && !bRank) {
    return -1;
  } else if (!aRank && bRank) {
    return 1;
  }

  const aScore = typeof a.score === 'number' ? a.score : Number.NEGATIVE_INFINITY;
  const bScore = typeof b.score === 'number' ? b.score : Number.NEGATIVE_INFINITY;
  if (aScore !== bScore) return bScore - aScore;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function scoreForPosition(sentiment, position, totalCount) {
  const [min, max] = SCORE_RANGES[sentiment] || [1, 10];
  const ratio = position / (totalCount - 1 || 1);
  return Math.round((max - (max - min) * ratio) * 10) / 10;
}

export function deriveDisplayScoresForGroup(entries, sentiment) {
  const sorted = [...entries].sort(sortRatingsByRank);
  return sorted.map((entry, idx) => ({
    ...entry,
    displayScore:
      typeof entry.scoreBasic === 'number'
        ? clampScore(entry.scoreBasic)
        : scoreForPosition(sentiment, idx, sorted.length),
  }));
}

function tvEntryKey(entry) {
  return `${entry.mediaId}|${entry.season == null ? 'show' : entry.season}`;
}

function movieEntryKey(entry) {
  return String(entry.mediaId);
}

/**
 * Recompute scoreBasic for every rating: uniform 0–10 within each cohort (lexorank order),
 * using the same ranges as display (not-good / okay / good / amazing).
 * Movie cohorts: all entries in a sentiment bucket.
 * TV whole-show cohorts: entries with season == null in that sentiment.
 * TV season cohorts: per (mediaId, sentiment) among season rows.
 */
export function enrichRatingsWithScoreBasic(ratings) {
  const src = ratings || { movie: {}, tv: {} };
  const result = { movie: {}, tv: {} };

  for (const sentiment of Object.keys(src.movie || {})) {
    const arr = src.movie[sentiment] || [];
    const sorted = [...arr].sort(sortRatingsByRank);
    const n = sorted.length;
    const basics = new Map();
    sorted.forEach((e, i) => {
      basics.set(movieEntryKey(e), scoreForPosition(sentiment, i, n));
    });
    result.movie[sentiment] = arr.map((e) => ({
      ...e,
      scoreBasic: basics.get(movieEntryKey(e)),
    }));
  }

  for (const sentiment of Object.keys(src.tv || {})) {
    const arr = src.tv[sentiment] || [];
    const whole = arr.filter((e) => e.season == null);
    const seasons = arr.filter((e) => e.season != null);

    const sortedWhole = [...whole].sort(sortRatingsByRank);
    const nWhole = sortedWhole.length;
    const wholeBasics = new Map();
    sortedWhole.forEach((e, i) => {
      wholeBasics.set(tvEntryKey(e), scoreForPosition(sentiment, i, nWhole));
    });

    const byShow = new Map();
    for (const e of seasons) {
      const k = String(e.mediaId);
      if (!byShow.has(k)) byShow.set(k, []);
      byShow.get(k).push(e);
    }
    const seasonBasics = new Map();
    for (const group of byShow.values()) {
      const sortedS = [...group].sort(sortRatingsByRank);
      const nS = sortedS.length;
      sortedS.forEach((e, i) => {
        seasonBasics.set(tvEntryKey(e), scoreForPosition(sentiment, i, nS));
      });
    }

    result.tv[sentiment] = arr.map((e) => ({
      ...e,
      scoreBasic: e.season == null
        ? wholeBasics.get(tvEntryKey(e))
        : seasonBasics.get(tvEntryKey(e)),
    }));
  }

  return result;
}

/**
 * Derive display scores for all TV entries while keeping whole-show and season
 * cohorts independent:
 * - Whole shows are scored against other whole shows in the same sentiment.
 * - Seasons are scored within each show's season cohort and anchored around the
 *   whole-show score for that show.
 */
export function deriveDisplayScoresForTv(ratingsBySentiment) {
  const bySentiment = ratingsBySentiment || {};
  const wholeByShow = new Map();
  const seasonEntries = [];

  for (const sentiment of Object.keys(bySentiment)) {
    const entries = bySentiment[sentiment] || [];
    const wholeEntries = entries.filter((e) => e.season == null);
    const seasonOnlyEntries = entries.filter((e) => e.season != null);

    deriveDisplayScoresForGroup(wholeEntries, sentiment).forEach((entry) => {
      wholeByShow.set(String(entry.mediaId), entry);
    });

    seasonEntries.push(
      ...seasonOnlyEntries.map((entry) => ({
        ...entry,
        __sentiment: sentiment,
      }))
    );
  }

  const seasonsByShow = new Map();
  for (const entry of seasonEntries) {
    const key = String(entry.mediaId);
    if (!seasonsByShow.has(key)) seasonsByShow.set(key, []);
    seasonsByShow.get(key).push(entry);
  }

  const derivedSeasons = [];
  for (const [mediaId, entries] of seasonsByShow.entries()) {
    const anchor = wholeByShow.has(mediaId)
      ? wholeByShow.get(mediaId).displayScore
      : 9;

    const raw = [];
    const entriesBySentiment = new Map();
    entries.forEach((entry) => {
      const sentiment = entry.__sentiment || 'good';
      if (!entriesBySentiment.has(sentiment)) entriesBySentiment.set(sentiment, []);
      entriesBySentiment.get(sentiment).push(entry);
    });

    for (const [sentiment, sentimentEntries] of entriesBySentiment.entries()) {
      const sorted = [...sentimentEntries].sort(sortRatingsByRank);
      const n = sorted.length;
      sorted.forEach((entry, idx) => {
        const centered = n <= 1 ? 0 : (0.5 - idx / (n - 1)) * 2;
        const rankDelta = centered * SEASON_RANK_SPREAD;
        const sentimentDelta = SEASON_SENTIMENT_OFFSETS[sentiment] ?? 0;
        raw.push({
          ...entry,
          __rawScore: anchor + sentimentDelta + rankDelta,
        });
      });
    }

    const rawAvg = raw.length
      ? raw.reduce((sum, item) => sum + item.__rawScore, 0) / raw.length
      : anchor;
    const correction = anchor - rawAvg;

    raw.forEach((entry) => {
      const legacyDisplay = clampScore(entry.__rawScore + correction);
      derivedSeasons.push({
        ...entry,
        displayScore:
          typeof entry.scoreBasic === 'number'
            ? clampScore(entry.scoreBasic)
            : legacyDisplay,
      });
    });
  }

  const cleanWhole = Array.from(wholeByShow.values()).map((entry) => ({
    ...entry,
    displayScore: clampScore(entry.displayScore),
  }));
  const cleanSeasons = derivedSeasons.map((entry) => {
    const { __sentiment, __rawScore, ...rest } = entry;
    return rest;
  });

  return [...cleanWhole, ...cleanSeasons];
}

