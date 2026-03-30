import SwiftUI
import Observation

enum ExploreFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case movies = "Movies"
    case shows = "TV Shows"
    case profiles = "Profiles"

    var id: String { rawValue }
}

@Observable
@MainActor
class ExploreViewModel {
    // Search state
    var query = ""
    var filter: ExploreFilter = .all
    var mediaResults: [TMDBSearchResult] = []
    var profileResults: [AppUser] = []
    var isSearching = false
    var searchError: String?

    // Trending state
    var trendingMovies: [MediaItem] = []
    var trendingShows: [MediaItem] = []
    var isLoadingTrending = false

    private let tmdb = TMDBService.shared
    private let db = FirestoreService.shared
    private var searchTask: Task<Void, Never>?

    // MARK: - Search (debounced)

    func onQueryChange(_ newQuery: String) {
        searchTask?.cancel()
        let trimmed = newQuery.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            mediaResults = []
            profileResults = []
            isSearching = false
            return
        }

        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)   // 300ms debounce
            guard !Task.isCancelled else { return }
            await performSearch(query: trimmed)
        }
    }

    func performSearch(query: String) async {
        isSearching = true
        searchError = nil
        defer { isSearching = false }

        await withTaskGroup(of: Void.self) { group in
            if filter == .all || filter == .movies || filter == .shows {
                group.addTask { await self.searchMedia(query: query) }
            }
            if filter == .all || filter == .profiles {
                group.addTask { await self.searchProfiles(query: query) }
            }
        }
    }

    private func searchMedia(query: String) async {
        do {
            let results = try await tmdb.searchMedia(query: query)
            mediaResults = results.filter { result in
                switch filter {
                case .all: return true
                case .movies: return result.resolvedMediaType == .movie
                case .shows: return result.resolvedMediaType == .tv
                case .profiles: return false
                }
            }
        } catch {
            searchError = error.localizedDescription
        }
    }

    private func searchProfiles(query: String) async {
        guard filter == .all || filter == .profiles else { return }
        let lower = query.lowercased()

        do {
            // Search by username prefix
            let byUsername = try await db.queryCollection(
                path: "users",
                filters: [
                    .init(field: "username", op: "GREATER_THAN_OR_EQUAL", value: lower),
                    .init(field: "username", op: "LESS_THAN_OR_EQUAL", value: lower + "\u{f8ff}")
                ],
                orderBy: "username",
                limit: 10
            )

            // Search by full name prefix
            let byName = try await db.queryCollection(
                path: "users",
                filters: [
                    .init(field: "fullNameLower", op: "GREATER_THAN_OR_EQUAL", value: lower),
                    .init(field: "fullNameLower", op: "LESS_THAN_OR_EQUAL", value: lower + "\u{f8ff}")
                ],
                orderBy: "fullNameLower",
                limit: 10
            )

            var seen = Set<String>()
            var users: [AppUser] = []
            for (id, data) in byUsername + byName {
                guard !seen.contains(id) else { continue }
                seen.insert(id)
                users.append(AppUser.from(id: id, data: data))
            }
            profileResults = users
        } catch {
            profileResults = []
        }
    }

    // MARK: - Trending

    func loadTrending() async {
        guard trendingMovies.isEmpty && trendingShows.isEmpty else { return }
        isLoadingTrending = true
        defer { isLoadingTrending = false }

        async let moviesTask = tmdb.trendingMovies()
        async let showsTask = tmdb.trendingShows()
        trendingMovies = (try? await moviesTask) ?? []
        trendingShows = (try? await showsTask) ?? []
    }

    var showingSearchResults: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }
}
