import Foundation
import Observation

// NOTE: Requires a composite Firestore index on the `activity` collection:
//   uid ASC, createdAt DESC
// Create this in the Firebase console before shipping.

@Observable
@MainActor
class HomeViewModel {
    var feedItems: [ActivityEntry] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true
    var error: String?

    // Poster path cache: keyed by mediaKey (e.g. "movie_123")
    private var posterPathCache: [String: String?] = [:]

    // Comments state: keyed by activityId
    var expandedComments: Set<String> = []
    var comments: [String: [ActivityComment]] = [:]
    var postingComment: Set<String> = []

    private var cursor: String?  // ISO8601 createdAt of the oldest loaded item
    private let db = FirestoreService.shared
    private let pageSize = 20

    // MARK: - Feed loading

    func loadFeed(followingUids: [String]) async {
        guard !followingUids.isEmpty else { isLoading = false; return }
        isLoading = true
        defer { isLoading = false }
        cursor = nil
        hasMore = true
        error = nil

        let results = await fetchPage(followingUids: followingUids, cursor: nil)
        feedItems = results
        cursor = results.last.map { ISO8601DateFormatter().string(from: $0.createdAt) }
        hasMore = results.count >= pageSize
    }

    func loadMore(followingUids: [String]) async {
        guard !isLoadingMore, hasMore, !followingUids.isEmpty else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        let results = await fetchPage(followingUids: followingUids, cursor: cursor)
        feedItems.append(contentsOf: results)
        cursor = results.last.map { ISO8601DateFormatter().string(from: $0.createdAt) }
        hasMore = results.count >= pageSize
    }

    // Fetches one page across all following-chunks in parallel, merges and trims to pageSize.
    private func fetchPage(followingUids: [String], cursor: String?) async -> [ActivityEntry] {
        let chunks = followingUids.chunked(into: 30)
        var allResults: [ActivityEntry] = []

        await withTaskGroup(of: [ActivityEntry].self) { group in
            for chunk in chunks {
                group.addTask {
                    var filters: [FirestoreService.QueryFilter] = [
                        .init(field: "uid", op: "IN", value: chunk)
                    ]
                    if let cursor {
                        filters.append(.init(field: "createdAt", op: "LESS_THAN", value: cursor))
                    }
                    do {
                        let rows = try await self.db.queryCollection(
                            path: "activity",
                            filters: filters,
                            orderBy: "createdAt",
                            descending: true,
                            limit: self.pageSize
                        )
                        return rows.compactMap { ActivityEntry.from(id: $0.id, data: $0.data) }
                    } catch {
                        await MainActor.run { self.error = error.localizedDescription }
                        return []
                    }
                }
            }
            for await chunk in group {
                allResults.append(contentsOf: chunk)
            }
        }

        return allResults
            .sorted { $0.createdAt > $1.createdAt }
            .prefix(pageSize)
            .map { $0 }
    }

    // MARK: - Poster path cache

    func cachedPosterPath(mediaKey: String) -> String? {
        guard let entry = posterPathCache[mediaKey] else { return nil }
        return entry  // may be nil if previously fetched and found no poster
    }

    func cachePosterPath(mediaKey: String, path: String?) {
        posterPathCache[mediaKey] = path
    }

    // MARK: - Upvotes (unified with discussion thread upvotes)

    func toggleUpvote(activityId: String, currentUid: String) async {
        guard let idx = feedItems.firstIndex(where: { $0.id == activityId }) else { return }
        let entry = feedItems[idx]
        guard let threadId = entry.threadId else { return }

        let wasUpvoted = entry.hasUpvoted(uid: currentUid)

        // Optimistic update
        if wasUpvoted {
            feedItems[idx].upvoterUids.removeAll { $0 == currentUid }
            feedItems[idx].voteCount -= 1
        } else {
            feedItems[idx].upvoterUids.append(currentUid)
            feedItems[idx].voteCount += 1
        }

        let delta = wasUpvoted ? -1 : 1
        let threadPath = "mediaDiscussions/\(entry.mediaKey)/threads/\(threadId)"
        let activityPath = "activity/\(activityId)"

        // Dual-write: keep thread and activity vote data in sync
        try? await db.commit(writes: [
            .init(kind: .increment(path: threadPath,   field: "voteCount",   amount: delta)),
            .init(kind: .increment(path: activityPath, field: "voteCount",   amount: delta)),
            wasUpvoted
                ? .init(kind: .arrayRemove(path: threadPath,   field: "upvoterUids", values: [currentUid]))
                : .init(kind: .arrayUnion( path: threadPath,   field: "upvoterUids", values: [currentUid])),
            wasUpvoted
                ? .init(kind: .arrayRemove(path: activityPath, field: "upvoterUids", values: [currentUid]))
                : .init(kind: .arrayUnion( path: activityPath, field: "upvoterUids", values: [currentUid]))
        ])
    }

    // MARK: - Comments

    func toggleComments(activityId: String) {
        if expandedComments.contains(activityId) {
            expandedComments.remove(activityId)
        } else {
            expandedComments.insert(activityId)
            if comments[activityId] == nil {
                Task { await loadComments(activityId: activityId) }
            }
        }
    }

    func loadComments(activityId: String) async {
        let rows = (try? await db.queryCollection(
            path: "activity/\(activityId)/comments",
            orderBy: "createdAt",
            limit: 50
        )) ?? []
        comments[activityId] = rows.compactMap { ActivityComment.from(id: $0.id, data: $0.data) }
    }

    func postComment(activityId: String, text: String, currentUser: AppUser) async {
        postingComment.insert(activityId)
        defer { postingComment.remove(activityId) }

        let stub = ActivityComment(
            id: UUID().uuidString,
            uid: currentUser.id,
            username: currentUser.username,
            photoURL: currentUser.photoURL,
            text: text,
            createdAt: Date()
        )
        do {
            let newId = try await db.addDocument(
                collectionPath: "activity/\(activityId)/comments",
                data: stub.toFirestoreData()
            )
            let saved = ActivityComment(
                id: newId,
                uid: stub.uid, username: stub.username,
                photoURL: stub.photoURL, text: stub.text, createdAt: stub.createdAt
            )
            comments[activityId, default: []].append(saved)
            if let idx = feedItems.firstIndex(where: { $0.id == activityId }) {
                feedItems[idx].commentCount += 1
            }
            try? await db.commit(writes: [
                .init(kind: .increment(path: "activity/\(activityId)", field: "commentCount", amount: 1))
            ])
        } catch {}
    }

    func deleteComment(activityId: String, commentId: String) async {
        try? await db.deleteDocument(path: "activity/\(activityId)/comments/\(commentId)")
        comments[activityId]?.removeAll { $0.id == commentId }
        if let idx = feedItems.firstIndex(where: { $0.id == activityId }) {
            feedItems[idx].commentCount = max(0, feedItems[idx].commentCount - 1)
        }
        try? await db.commit(writes: [
            .init(kind: .increment(path: "activity/\(activityId)", field: "commentCount", amount: -1))
        ])
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
