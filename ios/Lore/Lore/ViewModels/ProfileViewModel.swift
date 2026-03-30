import SwiftUI
import Observation

@Observable
@MainActor
class ProfileViewModel {
    var user: AppUser?
    var isLoading = false
    var error: String?

    // Tabs
    var movieRatings: [RatingEntry] = []
    var showRatings: [RatingEntry] = []
    var watchlistItems: [ListItem] = []
    var customLists: [CustomList] = []

    // Social
    var followerUsers: [AppUser] = []
    var followingUsers: [AppUser] = []
    var isFollowing = false

    // Tab loading state
    var loadedTabs = Set<String>()

    private let db = FirestoreService.shared
    private let tmdb = TMDBService.shared

    // MARK: - Load profile

    func loadProfile(uid: String, currentUid: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            guard let (id, data) = try await db.getDocument(path: "users/\(uid)") else {
                error = "User not found"
                return
            }
            user = AppUser.from(id: id, data: data)

            if let currentUid, currentUid != uid {
                isFollowing = user?.followerlist.contains(currentUid) ?? false
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Load tabs (lazy)

    func loadRatingsIfNeeded(uid: String) async {
        guard !loadedTabs.contains("ratings") else { return }
        loadedTabs.insert("ratings")

        do {
            let docs = try await db.listDocuments(path: "users/\(uid)/ratings")
            var movies: [RatingEntry] = []
            var shows: [RatingEntry] = []

            for (id, data) in docs {
                guard let entry = RatingEntry.from(docId: id, data: data) else { continue }
                if entry.mediaType == .movie { movies.append(entry) }
                else { shows.append(entry) }
            }

            movieRatings = RatingsEngine.deriveDisplayScores(for: movies)
            showRatings = RatingsEngine.deriveDisplayScores(for: shows)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadListsIfNeeded(uid: String, isOwner: Bool) async {
        guard !loadedTabs.contains("lists") else { return }
        loadedTabs.insert("lists")

        do {
            let docs = try await db.listDocuments(path: "users/\(uid)/customLists")
            var lists: [CustomList] = []
            for (id, data) in docs {
                guard let list = CustomList.from(id: id, data: data) else { continue }
                // Non-owners only see public lists
                if isOwner || list.visibility == .publicList {
                    lists.append(list)
                }
            }
            customLists = lists
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadWatchlistIfNeeded(uid: String) async {
        guard !loadedTabs.contains("watchlist") else { return }
        loadedTabs.insert("watchlist")

        guard let user else { return }
        var items = user.watchlist.map {
            ListItem(mediaId: $0.mediaId, mediaType: $0.mediaType, timestamp: $0.timestamp)
        }

        // Enrich with TMDB data
        await withTaskGroup(of: (Int, MediaItem?).self) { group in
            for (idx, item) in items.enumerated() {
                group.addTask {
                    guard let mediaId = Int(item.mediaId) else { return (idx, nil) }
                    let media = try? await TMDBService.shared.fetchDetails(mediaType: item.mediaType, id: mediaId)
                    return (idx, media)
                }
            }
            for await (idx, media) in group {
                items[idx].mediaItem = media
            }
        }
        watchlistItems = items
    }

    // MARK: - Follow / Unfollow

    func toggleFollow(targetUid: String, currentUid: String) async {
        let wasFollowing = isFollowing
        isFollowing.toggle()

        do {
            if wasFollowing {
                try await db.commit(writes: [
                    .init(kind: .arrayRemove(path: "users/\(currentUid)", field: "followinglist", values: [targetUid])),
                    .init(kind: .arrayRemove(path: "users/\(targetUid)", field: "followerlist", values: [currentUid]))
                ])
            } else {
                try await db.commit(writes: [
                    .init(kind: .arrayUnion(path: "users/\(currentUid)", field: "followinglist", values: [targetUid])),
                    .init(kind: .arrayUnion(path: "users/\(targetUid)", field: "followerlist", values: [currentUid]))
                ])
            }
            // Refresh follower count
            if let (_, data) = try await db.getDocument(path: "users/\(targetUid)") {
                user = AppUser.from(id: targetUid, data: data)
            }
        } catch {
            // Revert optimistic update
            isFollowing = wasFollowing
            self.error = error.localizedDescription
        }
    }

    // MARK: - Social lists (followers/following)

    func loadFollowers() async {
        guard let user else { return }
        followerUsers = await loadUsers(ids: user.followerlist)
    }

    func loadFollowing() async {
        guard let user else { return }
        followingUsers = await loadUsers(ids: user.followinglist)
    }

    private func loadUsers(ids: [String]) async -> [AppUser] {
        await withTaskGroup(of: AppUser?.self) { group in
            for uid in ids {
                group.addTask {
                    guard let (id, data) = try? await FirestoreService.shared.getDocument(path: "users/\(uid)")
                    else { return nil }
                    return AppUser.from(id: id, data: data)
                }
            }
            var result: [AppUser] = []
            for await user in group { if let u = user { result.append(u) } }
            return result
        }
    }

    // MARK: - Create list

    func createList(name: String, description: String, visibility: ListVisibility, ownerUid: String) async throws {
        let data: [String: Any] = [
            "name": name,
            "description": description,
            "visibility": visibility.rawValue,
            "items": [],
            "createdAt": ISO8601DateFormatter().string(from: Date())
        ]
        let newId = try await db.addDocument(collectionPath: "users/\(ownerUid)/customLists", data: data)
        let list = CustomList(id: newId, name: name, description: description, visibility: visibility, items: [])
        customLists.append(list)
    }

    // MARK: - Add item to custom list

    func addItemToList(listId: String, mediaId: String, mediaType: MediaType, ownerUid: String) async throws {
        guard let idx = customLists.firstIndex(where: { $0.id == listId }) else { return }
        var list = customLists[idx]
        guard !list.items.contains(where: { $0.mediaId == mediaId && $0.mediaType == mediaType }) else { return }
        let newItem = ListItem(
            mediaId: mediaId,
            mediaType: mediaType,
            timestamp: ISO8601DateFormatter().string(from: Date())
        )
        list.items.append(newItem)
        customLists[idx] = list
        try await db.updateDocument(
            path: "users/\(ownerUid)/customLists/\(listId)",
            fields: ["items": list.items.map { $0.toDict() }]
        )
    }

    // MARK: - Watchlist toggle

    func toggleWatchlist(mediaId: String, mediaType: MediaType, currentUser: AppUser) async {
        var updatedUser = currentUser
        if let idx = updatedUser.watchlist.firstIndex(where: { $0.mediaId == mediaId && $0.mediaType == mediaType }) {
            updatedUser.watchlist.remove(at: idx)
        } else {
            updatedUser.watchlist.append(WatchlistItem(
                mediaId: mediaId,
                mediaType: mediaType,
                timestamp: ISO8601DateFormatter().string(from: Date())
            ))
        }

        let watchlistData = updatedUser.watchlist.map { $0.toDict() }
        do {
            try await db.updateDocument(
                path: "users/\(currentUser.id)",
                fields: ["lists": ["watchlist": watchlistData]],
                mask: ["lists.watchlist"]
            )
        } catch {
            self.error = error.localizedDescription
        }
    }
}
