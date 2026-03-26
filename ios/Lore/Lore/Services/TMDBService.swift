import Foundation

enum TMDBError: Error, LocalizedError {
    case invalidURL
    case networkError(Error)
    case decodingError(Error)
    case serverError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .networkError(let e): return e.localizedDescription
        case .decodingError(let e): return "Decoding error: \(e.localizedDescription)"
        case .serverError(let code): return "Server error \(code)"
        }
    }
}

actor TMDBService {
    static let shared = TMDBService()
    private init() {}

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .useDefaultKeys
        return d
    }()

    // MARK: - Core fetch

    private func fetch<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = []) async throws -> T {
        var components = URLComponents(string: "\(Config.tmdbBaseUrl)\(path)")!
        var items = queryItems
        items.append(URLQueryItem(name: "language", value: "en-US"))
        components.queryItems = items

        guard let url = components.url else { throw TMDBError.invalidURL }

        var req = URLRequest(url: url)
        req.setValue("Bearer \(Config.tmdbReadAccessToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { throw TMDBError.serverError(status) }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw TMDBError.decodingError(error)
        }
    }

    // MARK: - Search

    func searchMedia(query: String) async throws -> [TMDBSearchResult] {
        let response: TMDBSearchResponse = try await fetch(
            "/search/multi",
            queryItems: [
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "include_adult", value: "false")
            ]
        )
        return response.results.filter { $0.resolvedMediaType != nil }
    }

    func searchMovies(query: String, year: String? = nil) async throws -> [TMDBSearchResult] {
        var items = [URLQueryItem(name: "query", value: query)]
        if let year { items.append(URLQueryItem(name: "primary_release_year", value: year)) }
        let response: TMDBSearchResponse = try await fetch("/search/movie", queryItems: items)
        return response.results.map {
            TMDBSearchResult(
                id: $0.id,
                mediaType: "movie",
                title: $0.title,
                name: $0.name,
                overview: $0.overview,
                posterPath: $0.posterPath,
                releaseDate: $0.releaseDate,
                firstAirDate: $0.firstAirDate,
                genreIds: $0.genreIds,
                popularity: $0.popularity
            )
        }
    }

    // MARK: - Details

    func fetchMovieDetails(id: Int) async throws -> MediaItem {
        let detail: TMDBMovieDetail = try await fetch(
            "/movie/\(id)",
            queryItems: [URLQueryItem(name: "append_to_response", value: "credits")]
        )
        return detail.toMediaItem()
    }

    func fetchTVDetails(id: Int) async throws -> MediaItem {
        let detail: TMDBTVDetail = try await fetch(
            "/tv/\(id)",
            queryItems: [URLQueryItem(name: "append_to_response", value: "credits")]
        )
        return detail.toMediaItem()
    }

    func fetchDetails(mediaType: MediaType, id: Int) async throws -> MediaItem {
        switch mediaType {
        case .movie: return try await fetchMovieDetails(id: id)
        case .tv: return try await fetchTVDetails(id: id)
        }
    }

    // MARK: - Trending / Popular

    func trendingMovies() async throws -> [MediaItem] {
        let response: TMDBTrendingResponse = try await fetch("/trending/movie/week")
        return response.results.map { $0.toMediaItem() }
    }

    func trendingShows() async throws -> [MediaItem] {
        let response: TMDBTrendingResponse = try await fetch("/trending/tv/week")
        return response.results.map { $0.toMediaItem() }
    }

    func popularMedia() async throws -> [MediaItem] {
        struct PopularResponse: Decodable { let results: [TMDBTrendingItem] }

        async let movies: PopularResponse = fetch("/movie/popular")
        async let shows: PopularResponse = fetch("/tv/popular")

        let (m, s) = try await (movies, shows)
        var all = (m.results + s.results).map { $0.toMediaItem() }
        all.shuffle()
        return Array(all.prefix(20))
    }

    // MARK: - Image URL helpers (nonisolated, no async)

    nonisolated func posterUrl(_ path: String?, size: String = "w342") -> String? {
        guard let path else { return nil }
        return "\(Config.tmdbImageBase)/\(size)\(path)"
    }
}
