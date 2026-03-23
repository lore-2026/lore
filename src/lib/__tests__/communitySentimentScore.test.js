import {
  computeCommunityRatingFromSentiment,
  pointInSentimentBucket,
} from '../communitySentimentScore';

describe('pointInSentimentBucket', () => {
  const amazing = { floor: 7.5, ceil: 10, k: 2 };
  const good = { floor: 5.5, ceil: 7.5, k: 4 };

  it('returns null for non-positive n', () => {
    expect(pointInSentimentBucket(0, amazing)).toBeNull();
    expect(pointInSentimentBucket(-1, amazing)).toBeNull();
  });

  it('puts a single amazing vote in the lower part of the amazing band (not 10)', () => {
    const p = pointInSentimentBucket(1, amazing);
    expect(p).toBeGreaterThanOrEqual(7.5);
    expect(p).toBeLessThanOrEqual(8.8);
    expect(p).toBeCloseTo(7.5 + 2.5 * (1 / 3), 5);
  });

  it('approaches ceil as n grows', () => {
    const p1 = pointInSentimentBucket(1, good);
    const p20 = pointInSentimentBucket(20, good);
    expect(p20).toBeGreaterThan(p1);
    expect(p20).toBeLessThanOrEqual(7.5);
  });
});

describe('computeCommunityRatingFromSentiment', () => {
  describe('invalid or empty input', () => {
    it('returns null when counts is null', () => {
      expect(computeCommunityRatingFromSentiment(null)).toBeNull();
    });

    it('returns null when counts is undefined', () => {
      expect(computeCommunityRatingFromSentiment(undefined)).toBeNull();
    });

    it('returns null when counts is not a plain object', () => {
      expect(computeCommunityRatingFromSentiment('x')).toBeNull();
      expect(computeCommunityRatingFromSentiment(42)).toBeNull();
    });

    it('returns null for an array', () => {
      expect(computeCommunityRatingFromSentiment([])).toBeNull();
    });

    it('returns null when all buckets are zero', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 0,
          amazing: 0,
        })
      ).toBeNull();
    });

    it('returns null when object is empty', () => {
      expect(computeCommunityRatingFromSentiment({})).toBeNull();
    });

    it('clamps negative bucket values to zero', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 1,
          okay: 0,
          good: 0,
          amazing: -1,
        })
      ).toBe(0.9);
    });
  });

  describe('single-bucket saturation (few votes low in band, many approach top)', () => {
    it('one amazing is well below 10 (bias toward bottom of amazing band)', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 0,
          amazing: 1,
        })
      ).toBe(8.3);
    });

    it('many unanimous amazings approach 10', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 0,
          amazing: 100,
        })
      ).toBe(10);
    });

    it('coerces string counts', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 0,
          amazing: '2',
        })
      ).toBe(8.8);
    });

    it('all good votes: few ratings sit low in the good band', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 5,
          amazing: 0,
        })
      ).toBe(6.6);
    });

    it('all okay votes', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 3,
          good: 0,
          amazing: 0,
        })
      ).toBe(3.9);
    });

    it('all not-good votes', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 2,
          okay: 0,
          good: 0,
          amazing: 0,
        })
      ).toBe(1.2);
    });
  });

  describe('sparse keys', () => {
    it('only amazing key present', () => {
      expect(computeCommunityRatingFromSentiment({ amazing: 1 })).toBe(8.3);
    });

    it('only good key present', () => {
      expect(computeCommunityRatingFromSentiment({ good: 1 })).toBe(5.9);
    });
  });

  describe('mixed sentiment', () => {
    it('one good among many amazing stays below 10', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 1,
          amazing: 99,
        })
      ).toBe(9.9);
    });

    it('50/50 good and amazing', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 5,
          amazing: 5,
        })
      ).toBe(7.9);
    });

    it('one good and one amazing', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 1,
          amazing: 1,
        })
      ).toBe(7.1);
    });

    it('not-good pulls below good-only pair', () => {
      const goodOnly = computeCommunityRatingFromSentiment({
        notGood: 0,
        okay: 0,
        good: 2,
        amazing: 0,
      });
      const withNotGood = computeCommunityRatingFromSentiment({
        notGood: 1,
        okay: 0,
        good: 1,
        amazing: 0,
      });
      expect(withNotGood).toBeLessThan(goodOnly);
    });

    it('one amazing and one not-good', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 1,
          okay: 0,
          good: 0,
          amazing: 1,
        })
      ).toBe(4.6);
    });

    it('one amazing and one okay', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 1,
          good: 0,
          amazing: 1,
        })
      ).toBe(5.9);
    });

    it('not-good and okay only', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 2,
          okay: 3,
          good: 0,
          amazing: 0,
        })
      ).toBe(2.8);
    });

    it('fractional bucket counts', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 0,
          okay: 0,
          good: 0.5,
          amazing: 1.5,
        })
      ).toBe(7.9);
    });

    it('four-way mix', () => {
      expect(
        computeCommunityRatingFromSentiment({
          notGood: 1,
          okay: 1,
          good: 1,
          amazing: 1,
        })
      ).toBe(4.6);
    });
  });

  describe('output shape', () => {
    it('rounds to one decimal place', () => {
      const score = computeCommunityRatingFromSentiment({
        notGood: 1,
        okay: 2,
        good: 3,
        amazing: 4,
      });
      expect(score).toBe(Math.round(score * 10) / 10);
    });

    it('stays within 0–10', () => {
      const score = computeCommunityRatingFromSentiment({
        notGood: 1,
        okay: 1,
        good: 1,
        amazing: 1,
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
    });
  });
});
