import Foundation

// MARK: - LexoRank
// Lexicographic rank keys for stable ordering within sentiment groups.
// Alphabet: 0-9A-Za-z (62 chars), key length: 12 chars.
// Lower key = higher rank (best items have smallest keys).

enum LexoRank {
    private static let alphabet: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
    private static let base = alphabet.count         // 62
    private static let length = 12

    // MARK: - Encode / Decode

    static func encode(_ value: UInt64) -> String {
        var result = Array(repeating: alphabet[0], count: length)
        var v = value
        for i in stride(from: length - 1, through: 0, by: -1) {
            result[i] = alphabet[Int(v % UInt64(base))]
            v /= UInt64(base)
        }
        return String(result)
    }

    static func decode(_ key: String) -> UInt64 {
        var result: UInt64 = 0
        for ch in key {
            guard let idx = alphabet.firstIndex(of: ch) else { continue }
            result = result * UInt64(base) + UInt64(idx)
        }
        return result
    }

    // MARK: - Key generation

    static let maxValue: UInt64 = {
        var v: UInt64 = 0
        for _ in 0..<length { v = v * UInt64(base) + UInt64(base - 1) }
        return v
    }()

    static func initialKey() -> String {
        encode(maxValue / 2)
    }

    /// Returns a key strictly between left and right (null = unbounded).
    static func keyBetween(_ left: String?, _ right: String?) -> String? {
        let lo: UInt64 = left.map { decode($0) + 1 } ?? 0
        let hi: UInt64 = right.map { decode($0) } ?? maxValue

        guard hi > lo else { return nil }
        let mid = lo + (hi - lo) / 2
        let result = encode(mid)
        // Verify strictly between
        if let l = left, result <= l { return nil }
        if let r = right, result >= r { return nil }
        return result
    }

    /// Generate `count` evenly-spaced keys for rebalancing.
    static func rebalanceKeys(count: Int) -> [String] {
        guard count > 0 else { return [] }
        let step = maxValue / UInt64(count + 1)
        return (1...count).map { encode(step * UInt64($0)) }
    }

    static func compare(_ a: String, _ b: String) -> ComparisonResult {
        let da = decode(a), db = decode(b)
        if da < db { return .orderedAscending }
        if da > db { return .orderedDescending }
        return .orderedSame
    }
}

// MARK: - Scoring

enum RatingsEngine {
    // MARK: - Score from position within a sentiment group

    /// Map a 0-based position within a sorted group to a display score.
    /// position 0 = best (highest score), position total-1 = worst.
    static func scoreForPosition(sentiment: Sentiment, position: Int, total: Int) -> Double {
        let range = sentiment.scoreRange
        guard total > 1 else { return range.upperBound }
        let ratio = Double(position) / Double(total - 1)   // 0.0 (best) → 1.0 (worst)
        let score = range.upperBound - ratio * (range.upperBound - range.lowerBound)
        return (score * 10).rounded() / 10   // round to 1 decimal
    }

    // MARK: - Derive display scores for a movie/whole-show group

    /// Takes all ratings in one sentiment group, sorts by rank key (or legacy score),
    /// and assigns display scores based on position.
    static func deriveDisplayScores(for entries: [RatingEntry]) -> [RatingEntry] {
        guard !entries.isEmpty else { return [] }

        // Group by sentiment
        var result: [RatingEntry] = []
        let bySentiment = Dictionary(grouping: entries) { $0.sentiment }

        for sentiment in Sentiment.allCases {
            guard var group = bySentiment[sentiment] else { continue }

            // Sort by lexorank key (scoreV2), fallback to legacy score descending
            group.sort { a, b in
                if let ka = a.scoreV2, let kb = b.scoreV2 {
                    return LexoRank.compare(ka, kb) == .orderedAscending
                }
                return a.score > b.score
            }

            for (idx, var entry) in group.enumerated() {
                entry.displayScore = scoreForPosition(
                    sentiment: sentiment,
                    position: idx,
                    total: group.count
                )
                result.append(entry)
            }
        }

        return result.sorted { ($0.displayScore ?? 0) > ($1.displayScore ?? 0) }
    }

    // MARK: - Binary insertion sort helpers

    /// Given a sorted list of entries, returns the median index for the first comparison.
    static func midpointIndex(in entries: [RatingEntry]) -> Int {
        entries.count / 2
    }

    /// After user comparison, returns the next comparison index (binary search step).
    /// Returns nil when the insertion position is determined.
    static func nextComparisonIndex(
        lo: Int, hi: Int, currentIndex: Int, userPrefersCurrent: Bool
    ) -> (newLo: Int, newHi: Int, nextIndex: Int?) {
        if userPrefersCurrent {
            // Current item is better → insert before comparison item → search lower half
            let newHi = currentIndex
            let newLo = lo
            let range = newHi - newLo
            if range <= 1 { return (newLo, newHi, nil) }   // found position
            return (newLo, newHi, newLo + range / 2)
        } else {
            // Comparison item is better → insert after comparison item → search upper half
            let newLo = currentIndex + 1
            let newHi = hi
            let range = newHi - newLo
            if range <= 0 { return (newLo, newHi, nil) }
            return (newLo, newHi, newLo + range / 2)
        }
    }

    /// Generate the lexorank key for inserting at position `insertAt` within a sorted group.
    /// The group should already be sorted by rank key.
    static func rankKeyForInsertion(
        at insertAt: Int,
        in group: [RatingEntry]
    ) -> String {
        let leftKey = insertAt > 0 ? group[insertAt - 1].scoreV2 : nil
        let rightKey = insertAt < group.count ? group[insertAt].scoreV2 : nil

        if let key = LexoRank.keyBetween(leftKey, rightKey) {
            return key
        }
        // Need to rebalance
        let newKeys = LexoRank.rebalanceKeys(count: group.count + 1)
        return newKeys[insertAt]
    }

    // MARK: - Community average

    static func average(scores: [Double]) -> Double? {
        guard !scores.isEmpty else { return nil }
        let sum = scores.reduce(0, +)
        let avg = sum / Double(scores.count)
        return (avg * 10).rounded() / 10
    }
}
