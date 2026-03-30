import Foundation

// MARK: - Sentiment

enum Sentiment: String, Codable, CaseIterable, Hashable, Sendable {
    case notGood = "not-good"
    case okay = "okay"
    case good = "good"
    case amazing = "amazing"

    var displayName: String {
        switch self {
        case .notGood: return "Not good"
        case .okay: return "Okay"
        case .good: return "Good"
        case .amazing: return "Amazing"
        }
    }

    var scoreRange: ClosedRange<Double> {
        switch self {
        case .notGood: return 1...3
        case .okay: return 4...6
        case .good: return 7...8
        case .amazing: return 9...10
        }
    }

    var emoji: String {
        switch self {
        case .notGood: return "😕"
        case .okay: return "😐"
        case .good: return "😊"
        case .amazing: return "🤩"
        }
    }
}

// MARK: - Rating Entry

struct RatingEntry: Identifiable, Hashable, Sendable {
    var id: String { docId }
    var docId: String           // e.g. "movie_123" or "tv_456_show" or "tv_456_1"
    var mediaType: MediaType
    var mediaId: Int
    var mediaName: String?
    var sentiment: Sentiment
    var score: Double           // legacy numeric score
    var scoreV2: String?        // lexorank key (current ordering system)
    var note: String?
    var timestamp: String
    var season: Int?            // nil = whole show or movie

    var isSeasonRating: Bool { season != nil }
    var displayScore: Double?   // derived, not stored in Firestore

    // MARK: - Doc ID helpers

    static func docId(mediaType: MediaType, mediaId: Int, season: Int?) -> String {
        switch mediaType {
        case .movie:
            return "movie_\(mediaId)"
        case .tv:
            if let s = season {
                return "tv_\(mediaId)_\(s)"
            } else {
                return "tv_\(mediaId)"
            }
        }
    }

    // MARK: - Firestore parsing

    static func from(docId: String, data: [String: Any]) -> RatingEntry? {
        guard
            let rawType = data["mediaType"] as? String,
            let mediaType = MediaType(rawValue: rawType)
        else { return nil }

        // Sentiment defaults to "good" when absent (matches web app fallback)
        let rawSentiment = data["sentiment"] as? String ?? "good"
        let sentiment = Sentiment(rawValue: rawSentiment) ?? .good

        let mediaId: Int
        if let i = data["mediaId"] as? Int {
            mediaId = i
        } else if let d = data["mediaId"] as? Double {
            mediaId = Int(d)
        } else if let s = data["mediaId"] as? String, let i = Int(s) {
            mediaId = i
        } else {
            return nil
        }

        // scoreBasic is the source of truth for display score
        let score: Double
        if let s = data["scoreBasic"] as? Double {
            score = s
        } else if let s = data["scoreBasic"] as? Int {
            score = Double(s)
        } else if let s = data["score"] as? Double {
            score = s
        } else if let s = data["score"] as? Int {
            score = Double(s)
        } else {
            score = sentiment.scoreRange.upperBound
        }

        return RatingEntry(
            docId: docId,
            mediaType: mediaType,
            mediaId: mediaId,
            mediaName: data["mediaName"] as? String,
            sentiment: sentiment,
            score: score,
            scoreV2: data["scoreV2"] as? String ?? data["score"] as? String,
            note: data["note"] as? String,
            timestamp: data["timestamp"] as? String ?? ISO8601DateFormatter().string(from: Date()),
            season: data["season"] as? Int
        )
    }

    func toFirestoreData() -> [String: Any] {
        var d: [String: Any] = [
            "mediaType": mediaType.rawValue,
            "mediaId": mediaId,
            "sentiment": sentiment.rawValue,
            "scoreBasic": score,     // numeric score (source of truth for display)
            "timestamp": timestamp
        ]
        if let name = mediaName { d["mediaName"] = name }
        if let v2 = scoreV2 { d["score"] = v2 }   // lexorank key stored in "score" field
        if let note = note { d["note"] = note }
        if let season = season { d["season"] = season }
        return d
    }
}

// MARK: - Ratings grouped by type and sentiment

typealias SentimentGroup = [Sentiment: [RatingEntry]]
typealias RatingsByType = [MediaType: SentimentGroup]
