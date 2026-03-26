import Foundation

// MARK: - Core enums

enum MediaType: String, Codable, Hashable, CaseIterable, Sendable {
    case movie = "movie"
    case tv = "tv"

    var displayName: String {
        switch self {
        case .movie: return "Movie"
        case .tv: return "TV Show"
        }
    }
}

// MARK: - Media Item (enriched from TMDB)

struct MediaItem: Identifiable, Codable, Hashable, Sendable {
    let id: Int
    let mediaType: MediaType
    let title: String
    let overview: String
    let posterPath: String?
    let releaseYear: String?
    let genres: [String]
    let runtime: Int?
    let numberOfSeasons: Int?
    let seasons: [TvSeason]?
    let cast: [CastMember]?

    func posterUrl(size: String = "w342") -> String {
        guard let path = posterPath else {
            return "placeholder"
        }
        return "\(Config.tmdbImageBase)/\(size)\(path)"
    }
}

struct TvSeason: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let seasonNumber: Int
    let name: String
    let episodeCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case seasonNumber = "season_number"
        case name
        case episodeCount = "episode_count"
    }
}

struct CastMember: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let character: String?
    let profilePath: String?

    enum CodingKeys: String, CodingKey {
        case id, name, character
        case profilePath = "profile_path"
    }

    func profileUrl(size: String = "w185") -> String? {
        guard let path = profilePath else { return nil }
        return "\(Config.tmdbImageBase)/\(size)\(path)"
    }
}

// MARK: - TMDB API raw response types

struct TMDBSearchResponse: Decodable, Sendable {
    let results: [TMDBSearchResult]
}

struct TMDBSearchResult: Decodable, Identifiable, Sendable {
    let id: Int
    let mediaType: String?
    let title: String?
    let name: String?
    let overview: String?
    let posterPath: String?
    let releaseDate: String?
    let firstAirDate: String?
    let genreIds: [Int]?
    let popularity: Double?

    var resolvedTitle: String { title ?? name ?? "Unknown" }

    var resolvedYear: String? {
        let dateStr = releaseDate ?? firstAirDate
        guard let d = dateStr, d.count >= 4 else { return nil }
        return String(d.prefix(4))
    }

    var resolvedMediaType: MediaType? {
        guard let raw = mediaType else { return nil }
        return MediaType(rawValue: raw)
    }

    enum CodingKeys: String, CodingKey {
        case id, title, name, overview, popularity
        case mediaType = "media_type"
        case posterPath = "poster_path"
        case releaseDate = "release_date"
        case firstAirDate = "first_air_date"
        case genreIds = "genre_ids"
    }

    func toMediaItem() -> MediaItem {
        MediaItem(
            id: id,
            mediaType: resolvedMediaType ?? .movie,
            title: resolvedTitle,
            overview: overview ?? "",
            posterPath: posterPath,
            releaseYear: resolvedYear,
            genres: [],
            runtime: nil,
            numberOfSeasons: nil,
            seasons: nil,
            cast: nil
        )
    }
}

struct TMDBMovieDetail: Decodable, Sendable {
    let id: Int
    let title: String
    let overview: String
    let posterPath: String?
    let releaseDate: String?
    let runtime: Int?
    let genres: [TMDBGenre]
    let credits: TMDBCredits?

    enum CodingKeys: String, CodingKey {
        case id, title, overview, runtime, genres, credits
        case posterPath = "poster_path"
        case releaseDate = "release_date"
    }

    func toMediaItem() -> MediaItem {
        MediaItem(
            id: id,
            mediaType: .movie,
            title: title,
            overview: overview,
            posterPath: posterPath,
            releaseYear: releaseDate.flatMap { $0.count >= 4 ? String($0.prefix(4)) : nil },
            genres: genres.map(\.name),
            runtime: runtime,
            numberOfSeasons: nil,
            seasons: nil,
            cast: credits?.cast.prefix(10).map { $0 }
        )
    }
}

struct TMDBTVDetail: Decodable, Sendable {
    let id: Int
    let name: String
    let overview: String
    let posterPath: String?
    let firstAirDate: String?
    let numberOfSeasons: Int?
    let seasons: [TvSeason]?
    let genres: [TMDBGenre]
    let credits: TMDBCredits?

    enum CodingKeys: String, CodingKey {
        case id, name, overview, genres, credits, seasons
        case posterPath = "poster_path"
        case firstAirDate = "first_air_date"
        case numberOfSeasons = "number_of_seasons"
    }

    func toMediaItem() -> MediaItem {
        MediaItem(
            id: id,
            mediaType: .tv,
            title: name,
            overview: overview,
            posterPath: posterPath,
            releaseYear: firstAirDate.flatMap { $0.count >= 4 ? String($0.prefix(4)) : nil },
            genres: genres.map(\.name),
            runtime: nil,
            numberOfSeasons: numberOfSeasons,
            seasons: seasons?.filter { $0.seasonNumber > 0 },
            cast: credits?.cast.prefix(10).map { $0 }
        )
    }
}

struct TMDBGenre: Decodable, Sendable {
    let id: Int
    let name: String
}

struct TMDBCredits: Decodable, Sendable {
    let cast: [CastMember]
}

struct TMDBTrendingResponse: Decodable, Sendable {
    let results: [TMDBTrendingItem]
}

struct TMDBTrendingItem: Decodable, Identifiable, Sendable {
    let id: Int
    let mediaType: String?
    let title: String?
    let name: String?
    let posterPath: String?
    let releaseDate: String?
    let firstAirDate: String?

    var resolvedTitle: String { title ?? name ?? "Unknown" }
    var resolvedYear: String? {
        let d = releaseDate ?? firstAirDate
        return d.flatMap { $0.count >= 4 ? String($0.prefix(4)) : nil }
    }
    var resolvedMediaType: MediaType? {
        MediaType(rawValue: mediaType ?? "")
    }

    enum CodingKeys: String, CodingKey {
        case id, title, name
        case mediaType = "media_type"
        case posterPath = "poster_path"
        case releaseDate = "release_date"
        case firstAirDate = "first_air_date"
    }

    func toMediaItem() -> MediaItem {
        MediaItem(
            id: id,
            mediaType: resolvedMediaType ?? .movie,
            title: resolvedTitle,
            overview: "",
            posterPath: posterPath,
            releaseYear: resolvedYear,
            genres: [],
            runtime: nil,
            numberOfSeasons: nil,
            seasons: nil,
            cast: nil
        )
    }
}
