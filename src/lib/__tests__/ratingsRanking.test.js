const {
  sortRatingsByRank,
  scoreForPosition,
  deriveDisplayScoresForGroup,
  deriveDisplayScoresForTv,
  enrichRatingsWithScoreBasic,
} = require('../ratingsRanking');

function byId(arr) {
  return Object.fromEntries(arr.map((x) => [x.id, x]));
}

describe('ratingsRanking', () => {
  describe('sortRatingsByRank', () => {
    test('sorts lexorank strings ascending', () => {
      const entries = [
        { id: 'c', score: 'kUzzzzzzzzzz' },
        { id: 'a', score: 'FUzzzzzzzzzz' },
        { id: 'b', score: 'Uzzzzzzzzzzz' },
      ];
      const sorted = [...entries].sort(sortRatingsByRank);
      expect(sorted.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    });

    test('falls back to numeric score when rank key missing', () => {
      const entries = [
        { id: 'low', score: 7.1 },
        { id: 'high', score: 9.2 },
      ];
      const sorted = [...entries].sort(sortRatingsByRank);
      expect(sorted.map((x) => x.id)).toEqual(['high', 'low']);
    });

    test('uses scoreV2 lexorank when score is not a rank string', () => {
      const entries = [
        { id: 'b', score: 8.3, scoreV2: 'Uzzzzzzzzzzz' },
        { id: 'a', score: null, scoreV2: 'FUzzzzzzzzzz' },
      ];
      const sorted = [...entries].sort(sortRatingsByRank);
      expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
    });

    test('prefers score lexorank over scoreV2 when both are present', () => {
      const entries = [
        { id: 'first', score: 'FUzzzzzzzzzz', scoreV2: 'zUzzzzzzzzzz' },
        { id: 'second', score: 'kUzzzzzzzzzz', scoreV2: 'AUzzzzzzzzzz' },
      ];
      const sorted = [...entries].sort(sortRatingsByRank);
      expect(sorted.map((x) => x.id)).toEqual(['first', 'second']);
    });

    test('entries with lexorank sort before entries without lexorank', () => {
      const entries = [
        { id: 'numeric', score: 9.8 },
        { id: 'ranked', score: 'Uzzzzzzzzzzz' },
      ];
      const sorted = [...entries].sort(sortRatingsByRank);
      expect(sorted.map((x) => x.id)).toEqual(['ranked', 'numeric']);
    });

    test('breaks ties by id when rank and numeric score are equal', () => {
      const entries = [
        { id: 'b', score: 7.5 },
        { id: 'a', score: 7.5 },
      ];
      const sorted = [...entries].sort(sortRatingsByRank);
      expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
    });
  });

  describe('scoreForPosition + deriveDisplayScoresForGroup', () => {
    test('top of amazing group maps to 10 and bottom to 9', () => {
      expect(scoreForPosition('amazing', 0, 3)).toBe(10);
      expect(scoreForPosition('amazing', 2, 3)).toBe(9);
    });

    test('deriveDisplayScoresForGroup uses rank order and sentiment range', () => {
      const entries = [
        { id: 'mid', mediaId: '2', score: 'Uzzzzzzzzzzz' },
        { id: 'top', mediaId: '1', score: 'FUzzzzzzzzzz' },
        { id: 'bottom', mediaId: '3', score: 'kUzzzzzzzzzz' },
      ];
      const derived = deriveDisplayScoresForGroup(entries, 'good');
      const map = byId(derived);
      expect(map.top.displayScore).toBe(8);
      expect(map.mid.displayScore).toBe(7.5);
      expect(map.bottom.displayScore).toBe(7);
    });

    test('single-item cohort maps to top of sentiment range', () => {
      expect(scoreForPosition('okay', 0, 1)).toBe(6);
      const derived = deriveDisplayScoresForGroup(
        [{ id: 'only', mediaId: '1', score: 'Uzzzzzzzzzzz' }],
        'not-good'
      );
      expect(derived).toHaveLength(1);
      expect(derived[0].displayScore).toBe(3);
    });

    test('unknown sentiment falls back to full 1..10 range', () => {
      expect(scoreForPosition('unknown-sentiment', 0, 3)).toBe(10);
      expect(scoreForPosition('unknown-sentiment', 2, 3)).toBe(1);
    });

    test('deriveDisplayScoresForGroup prefers stored scoreBasic when present', () => {
      const derived = deriveDisplayScoresForGroup(
        [{ id: 'a', mediaId: 1, score: 'zz', scoreBasic: 7.2 }],
        'good',
      );
      expect(derived[0].displayScore).toBe(7.2);
    });

    test('display scores are monotonic for lexorank-ordered cohorts', () => {
      const entries = [
        { id: 'r1', score: 'A00000000000' },
        { id: 'r2', score: 'B00000000000' },
        { id: 'r3', score: 'C00000000000' },
        { id: 'r4', score: 'D00000000000' },
        { id: 'r5', score: 'E00000000000' },
        { id: 'r6', score: 'F00000000000' },
      ];
      const derived = deriveDisplayScoresForGroup(entries, 'amazing').sort(sortRatingsByRank);
      for (let i = 1; i < derived.length; i += 1) {
        expect(derived[i - 1].displayScore).toBeGreaterThan(derived[i].displayScore);
      }
    });
  });

  describe('enrichRatingsWithScoreBasic', () => {
    test('assigns uniform movie scores per sentiment cohort', () => {
      const ratings = {
        movie: {
          good: [
            { mediaId: 1, score: 'B00000000000' },
            { mediaId: 2, score: 'A00000000000' },
          ],
        },
        tv: {},
      };
      const out = enrichRatingsWithScoreBasic(ratings);
      expect(out.movie.good[1].scoreBasic).toBe(8);
      expect(out.movie.good[0].scoreBasic).toBe(7);
    });

    test('TV whole-show and season cohorts are independent', () => {
      const ratings = {
        movie: {},
        tv: {
          amazing: [
            { mediaId: 10, mediaType: 'tv', score: 'A00000000000' },
            { mediaId: 11, mediaType: 'tv', season: 1, score: 'B00000000000' },
            { mediaId: 11, mediaType: 'tv', season: 2, score: 'A00000000000' },
          ],
        },
      };
      const out = enrichRatingsWithScoreBasic(ratings);
      const whole = out.tv.amazing.find((e) => e.season == null);
      const s1 = out.tv.amazing.find((e) => e.season === 1);
      const s2 = out.tv.amazing.find((e) => e.season === 2);
      expect(whole.scoreBasic).toBe(10);
      expect(s1.scoreBasic).toBe(9);
      expect(s2.scoreBasic).toBe(10);
    });
  });

  describe('deriveDisplayScoresForTv', () => {
    test('whole-show scores are independent of season scores', () => {
      const tv = {
        amazing: [
          { id: 'avatar_show', mediaId: '246', mediaType: 'tv', score: 'FUzzzzzzzzzz' },
          { id: 'bb_show', mediaId: '1396', mediaType: 'tv', score: 'Uzzzzzzzzzzz' },
          { id: 'sev_show', mediaId: '95396', mediaType: 'tv', score: 'kUzzzzzzzzzz' },
          { id: 'avatar_s1', mediaId: '246', mediaType: 'tv', season: 1, score: 'FUzzzzzzzzzz' },
          { id: 'avatar_s2', mediaId: '246', mediaType: 'tv', season: 2, score: 'Uzzzzzzzzzzz' },
          { id: 'avatar_s3', mediaId: '246', mediaType: 'tv', season: 3, score: 'kUzzzzzzzzzz' },
        ],
      };

      const derived = deriveDisplayScoresForTv(tv);
      const map = byId(derived);

      expect(map.avatar_show.displayScore).toBe(10);
      expect(map.bb_show.displayScore).toBe(9.5);
      expect(map.sev_show.displayScore).toBe(9);

      // Seasons should be centered around whole-show anchor and not exactly equal.
      const seasonAvg = (map.avatar_s1.displayScore + map.avatar_s2.displayScore + map.avatar_s3.displayScore) / 3;
      expect(Math.abs(seasonAvg - map.avatar_show.displayScore)).toBeLessThanOrEqual(0.2);
      expect(map.avatar_s1.displayScore).toBeGreaterThanOrEqual(map.avatar_s2.displayScore);
      expect(map.avatar_s2.displayScore).toBeGreaterThan(map.avatar_s3.displayScore);
    });

    test('season sentiment shifts season scores but keeps anchor near whole show', () => {
      const tv = {
        amazing: [
          { id: 'show', mediaId: '246', mediaType: 'tv', score: 'Uzzzzzzzzzzz' },
          { id: 's1', mediaId: '246', mediaType: 'tv', season: 1, score: 'FUzzzzzzzzzz' },
          { id: 's2', mediaId: '246', mediaType: 'tv', season: 2, score: 'Uzzzzzzzzzzz' },
        ],
        good: [
          { id: 's3', mediaId: '246', mediaType: 'tv', season: 3, score: 'FUzzzzzzzzzz' },
        ],
      };

      const derived = deriveDisplayScoresForTv(tv);
      const map = byId(derived);

      expect(map.show.displayScore).toBe(10);
      expect(map.s1.displayScore).toBeGreaterThanOrEqual(map.s2.displayScore);
      expect(map.s3.displayScore).toBeLessThan(map.s1.displayScore);

      const seasonAvg = (map.s1.displayScore + map.s2.displayScore + map.s3.displayScore) / 3;
      expect(seasonAvg).toBeLessThanOrEqual(10);
      expect(Math.abs(seasonAvg - map.show.displayScore)).toBeLessThanOrEqual(0.2);
    });

    test('caps scores at 10 for high-anchor edge cases', () => {
      const tv = {
        amazing: [
          { id: 'show', mediaId: '500', mediaType: 'tv', score: 'FUzzzzzzzzzz' },
          { id: 'other_show', mediaId: '501', mediaType: 'tv', score: 'zzzzzzzzzzzz' },
          { id: 's1', mediaId: '500', mediaType: 'tv', season: 1, score: 'FUzzzzzzzzzz' },
          { id: 's2', mediaId: '500', mediaType: 'tv', season: 2, score: 'Uzzzzzzzzzzz' },
          { id: 's3', mediaId: '500', mediaType: 'tv', season: 3, score: 'kUzzzzzzzzzz' },
          { id: 's4', mediaId: '500', mediaType: 'tv', season: 4, score: 'zUzzzzzzzzzz' },
        ],
      };

      const derived = deriveDisplayScoresForTv(tv);
      const seasonScores = derived
        .filter((x) => x.mediaId === '500' && x.season != null)
        .map((x) => x.displayScore);

      expect(seasonScores.length).toBe(4);
      seasonScores.forEach((score) => {
        expect(score).toBeLessThanOrEqual(10);
        expect(score).toBeGreaterThanOrEqual(1);
      });
    });

    test('season-only shows use default anchor and preserve season rank ordering', () => {
      const tv = {
        good: [
          { id: 's1', mediaId: '700', mediaType: 'tv', season: 1, score: 'FUzzzzzzzzzz' },
          { id: 's2', mediaId: '700', mediaType: 'tv', season: 2, score: 'Uzzzzzzzzzzz' },
          { id: 's3', mediaId: '700', mediaType: 'tv', season: 3, score: 'kUzzzzzzzzzz' },
        ],
      };

      const derived = deriveDisplayScoresForTv(tv);
      const map = byId(derived);
      const seasonAvg = (map.s1.displayScore + map.s2.displayScore + map.s3.displayScore) / 3;

      expect(derived.filter((x) => x.season != null)).toHaveLength(3);
      expect(map.s1.displayScore).toBeGreaterThan(map.s2.displayScore);
      expect(map.s2.displayScore).toBeGreaterThan(map.s3.displayScore);
      expect(Math.abs(seasonAvg - 9)).toBeLessThanOrEqual(0.2);
    });

    test('returns empty array for empty or missing sentiment buckets', () => {
      expect(deriveDisplayScoresForTv({})).toEqual([]);
      expect(deriveDisplayScoresForTv(null)).toEqual([]);
      expect(deriveDisplayScoresForTv({ amazing: null, good: [] })).toEqual([]);
    });
  });
});

