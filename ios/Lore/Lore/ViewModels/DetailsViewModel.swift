import SwiftUI
import Observation

enum RatingPhase {
    case initial            // Select sentiment + optional note
    case comparing          // Binary insertion sort
    case done               // Existing rating displayed
}

struct ComparisonState {
    var entries: [RatingEntry]      // sorted entries in sentiment group
    var lo: Int
    var hi: Int
    var currentIndex: Int

    var currentComparison: RatingEntry? {
        guard currentIndex < entries.count else { return nil }
        return entries[currentIndex]
    }
}

@Observable
@MainActor
class DetailsViewModel {
    var mediaItem: MediaItem?
    var isLoading = true
    var error: String?

    // Rating state
    var phase: RatingPhase = .initial
    var selectedSentiment: Sentiment?
    var selectedSeason: Int?            // nil = whole show
    var note: String = ""
    var comparison: ComparisonState?
    var newEntryKey: String?            // lexorank key computed during comparison

    // Existing ratings
    var myRating: RatingEntry?          // whole show / movie
    var mySeasonRatings: [Int: RatingEntry] = [:]
    var allMyRatings: [RatingEntry] = []    // enriched with displayScore

    // Social
    var friendsRatings: [AppUser: RatingEntry] = [:]
    var communityAverage: Double?
    var communityCount: Int = 0

    // Watchlist
    var isInWatchlist = false

    private let db = FirestoreService.shared
    private let tmdb = TMDBService.shared

    // MARK: - Load

    func load(mediaType: MediaType, mediaId: Int, currentUser: AppUser) async {
        isLoading = true
        defer { isLoading = false }

        do {
            async let media = tmdb.fetchDetails(mediaType: mediaType, id: mediaId)
            async let ratingsResult: Void = loadMyRatings(uid: currentUser.id, mediaType: mediaType, mediaId: mediaId)
            async let friendsResult: Void = loadFriendsRatings(mediaType: mediaType, mediaId: mediaId, followingIds: currentUser.followinglist)
            async let communityResult: Void = loadCommunityStats(mediaType: mediaType, mediaId: mediaId)

            let (m, _, _, _) = try await (media, ratingsResult, friendsResult, communityResult)
            mediaItem = m

            isInWatchlist = currentUser.watchlist.contains {
                $0.mediaId == "\(mediaId)" && $0.mediaType == mediaType
            }

            if myRating != nil {
                phase = .done
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadMyRatings(uid: String, mediaType: MediaType, mediaId: Int) async throws {
        let docId = RatingEntry.docId(mediaType: mediaType, mediaId: mediaId, season: nil)
        let path: String
        switch mediaType {
        case .movie: path = "users/\(uid)/ratings/\(docId)"
        case .tv: path = "users/\(uid)/ratings/tv_\(mediaId)_show"
        }

        if let (id, data) = try await db.getDocument(path: path),
           let entry = RatingEntry.from(docId: id, data: data) {
            myRating = entry
        }

        // Load season ratings for TV
        if mediaType == .tv {
            let seasons = try await db.listDocuments(path: "users/\(uid)/ratings/tv_\(mediaId)/seasons")
            for (id, data) in seasons {
                if let entry = RatingEntry.from(docId: id, data: data),
                   let season = entry.season {
                    mySeasonRatings[season] = entry
                }
            }
        }
    }

    private func loadFriendsRatings(mediaType: MediaType, mediaId: Int, followingIds: [String]) async throws {
        guard !followingIds.isEmpty else { return }
        let mediaKey = "\(mediaType.rawValue)_\(mediaId)"

        // Firestore `in` query supports up to 30 items
        let chunks = followingIds.chunked(into: 30)
        for chunk in chunks {
            let results = try await db.queryCollection(
                path: "mediaRatings/\(mediaKey)/userRatings",
                filters: [.init(field: "uid", op: "IN", value: chunk)]
            )
            for (id, data) in results {
                guard let entry = RatingEntry.from(docId: id, data: data),
                      let uid = data["uid"] as? String else { continue }
                if let (_, userData) = try await db.getDocument(path: "users/\(uid)") {
                    let user = AppUser.from(id: uid, data: userData)
                    friendsRatings[user] = entry
                }
            }
        }
    }

    private func loadCommunityStats(mediaType: MediaType, mediaId: Int) async throws {
        let mediaKey = "\(mediaType.rawValue)_\(mediaId)"
        if let (_, data) = try await db.getDocument(path: "mediaRatings/\(mediaKey)") {
            communityCount = data["ratingCount"] as? Int ?? 0
            let sum = data["sumScores"] as? Double ?? Double(data["sumScores"] as? Int ?? 0)
            if communityCount > 0 {
                communityAverage = (sum / Double(communityCount) * 10).rounded() / 10
            }
        }
    }

    // MARK: - Start rating

    func startRating(sentiment: Sentiment, season: Int?, existingRatings: [RatingEntry]) {
        selectedSentiment = sentiment
        selectedSeason = season
        note = ""

        // Get entries in the same sentiment group (same type, same season scope)
        let sameSentiment = existingRatings.filter {
            $0.sentiment == sentiment && ($0.season == nil) == (season == nil)
        }

        let sorted = sameSentiment.sorted {
            if let ka = $0.scoreV2, let kb = $1.scoreV2 {
                return LexoRank.compare(ka, kb) == .orderedAscending
            }
            return $0.score > $1.score
        }

        if sorted.isEmpty {
            // No comparisons needed — use initial key
            newEntryKey = LexoRank.initialKey()
            saveRating(uid: "", key: newEntryKey!)
            return
        }

        let midIdx = RatingsEngine.midpointIndex(in: sorted)
        comparison = ComparisonState(
            entries: sorted,
            lo: 0,
            hi: sorted.count,
            currentIndex: midIdx
        )
        phase = .comparing
    }

    func compareChoice(preferNewItem: Bool, uid: String) {
        guard var comp = comparison else { return }

        let (newLo, newHi, nextIndex) = RatingsEngine.nextComparisonIndex(
            lo: comp.lo,
            hi: comp.hi,
            currentIndex: comp.currentIndex,
            userPrefersCurrent: preferNewItem
        )

        comp.lo = newLo
        comp.hi = newHi

        if let next = nextIndex {
            comp.currentIndex = next
            comparison = comp
        } else {
            // Insertion position determined
            let key = RatingsEngine.rankKeyForInsertion(at: newLo, in: comp.entries)
            newEntryKey = key
            comparison = nil
            saveRating(uid: uid, key: key)
        }
    }

    func skipComparison(uid: String) {
        guard let comp = comparison else { return }
        let key = RatingsEngine.rankKeyForInsertion(at: comp.lo, in: comp.entries)
        newEntryKey = key
        comparison = nil
        saveRating(uid: uid, key: key)
    }

    private func saveRating(uid: String, key: String) {
        guard !uid.isEmpty,
              let sentiment = selectedSentiment,
              let mediaItem = mediaItem else { return }

        Task {
            let docId = RatingEntry.docId(mediaType: mediaItem.mediaType, mediaId: mediaItem.id, season: selectedSeason)
            let entry = RatingEntry(
                docId: docId,
                mediaType: mediaItem.mediaType,
                mediaId: mediaItem.id,
                mediaName: mediaItem.title,
                sentiment: sentiment,
                score: sentiment.scoreRange.upperBound,
                scoreV2: key,
                note: note.isEmpty ? nil : note,
                timestamp: ISO8601DateFormatter().string(from: Date()),
                season: selectedSeason
            )

            do {
                let path: String
                if mediaItem.mediaType == .tv, let season = selectedSeason {
                    path = "users/\(uid)/ratings/tv_\(mediaItem.id)/seasons/\(season)"
                } else {
                    path = "users/\(uid)/ratings/\(docId)"
                }

                try await db.commit(writes: [
                    .init(kind: .set(path: path, data: entry.toFirestoreData())),
                    .init(kind: .set(
                        path: "mediaRatings/\(mediaItem.mediaType.rawValue)_\(mediaItem.id)/userRatings/\(docId)",
                        data: entry.toFirestoreData()
                    )),
                    .init(kind: .increment(path: "users/\(uid)", field: "ratingCount", amount: 1))
                ])

                myRating = entry
                if let season = selectedSeason { mySeasonRatings[season] = entry }
                phase = .done
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    // MARK: - Delete rating

    func deleteRating(uid: String, season: Int? = nil) async {
        guard let mediaItem = mediaItem else { return }
        let docId = RatingEntry.docId(mediaType: mediaItem.mediaType, mediaId: mediaItem.id, season: season)

        let path: String
        if mediaItem.mediaType == .tv, let s = season {
            path = "users/\(uid)/ratings/tv_\(mediaItem.id)/seasons/\(s)"
        } else {
            path = "users/\(uid)/ratings/\(docId)"
        }

        do {
            try await db.commit(writes: [
                .init(kind: .delete(path: path)),
                .init(kind: .delete(path: "mediaRatings/\(mediaItem.mediaType.rawValue)_\(mediaItem.id)/userRatings/\(docId)")),
                .init(kind: .increment(path: "users/\(uid)", field: "ratingCount", amount: -1))
            ])

            if season == nil {
                myRating = nil
                if mySeasonRatings.isEmpty { phase = .initial }
            } else {
                mySeasonRatings.removeValue(forKey: season!)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Array chunk helper

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
