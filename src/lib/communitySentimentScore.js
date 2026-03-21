/**
 * Map Firestore sentimentCounts (movies + whole-show TV) to a single 0–10 community score.
 *
 * Model:
 * - Each sentiment bucket has a [floor, ceil] range on the 0–10 scale (the "band" for that label).
 * - With few votes in a bucket, the score for that bucket sits near the bottom of the band; as
 *   count grows, it moves toward the top: saturation = n / (n + k) per bucket.
 * - The community score is the count-weighted average of each bucket's current point.
 * - A single "Amazing" is no longer a 10: it lands in the lower part of the Amazing band (~8.3);
 *   many unanimous Amazings approach 10.
 */

const BUCKETS = {
  amazing: { floor: 7.5, ceil: 10, k: 2 },
  good: { floor: 5.5, ceil: 7.5, k: 4 },
  okay: { floor: 3.0, ceil: 5.0, k: 4 },
  notGood: { floor: 0.5, ceil: 2.5, k: 4 },
};

/**
 * @param {number} n count in this bucket (>= 0)
 * @param {{ floor: number, ceil: number, k: number }} spec
 */
export function pointInSentimentBucket(n, spec) {
  const c = Math.max(0, Number(n) || 0);
  if (c <= 0) return null;
  const { floor, ceil, k } = spec;
  return floor + (ceil - floor) * (c / (c + k));
}

/**
 * @param {{ notGood: number, okay: number, good: number, amazing: number }} counts
 * @returns {number | null} 0–10 in steps of 0.1, or null if no ratings
 */
export function computeCommunityRatingFromSentiment(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;

  const notGood = Math.max(0, Number(counts.notGood) || 0);
  const okay = Math.max(0, Number(counts.okay) || 0);
  const good = Math.max(0, Number(counts.good) || 0);
  const amazing = Math.max(0, Number(counts.amazing) || 0);
  const total = notGood + okay + good + amazing;
  if (total === 0) return null;

  const parts = [
    { n: amazing, spec: BUCKETS.amazing },
    { n: good, spec: BUCKETS.good },
    { n: okay, spec: BUCKETS.okay },
    { n: notGood, spec: BUCKETS.notGood },
  ];

  let weightedSum = 0;
  for (const { n, spec } of parts) {
    if (n <= 0) continue;
    const p = pointInSentimentBucket(n, spec);
    if (p == null) continue;
    weightedSum += n * p;
  }

  const raw = weightedSum / total;
  return Math.round(raw * 10) / 10;
}
