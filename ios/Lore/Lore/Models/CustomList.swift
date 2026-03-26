import Foundation

enum ListVisibility: String, Codable, CaseIterable, Sendable {
    case publicList = "public"
    case privateList = "private"

    var displayName: String {
        switch self {
        case .publicList: return "Public"
        case .privateList: return "Private"
        }
    }
}

struct CustomList: Identifiable, Hashable, Sendable {
    let id: String              // Firestore doc ID
    var name: String
    var description: String
    var visibility: ListVisibility
    var items: [ListItem]
    var createdAt: String?

    var isWatchlist: Bool { id == "watchlist" }

    static func from(id: String, data: [String: Any]) -> CustomList? {
        guard let name = data["name"] as? String else { return nil }

        let rawItems = data["items"] as? [[String: Any]] ?? []
        let items: [ListItem] = rawItems.compactMap { dict in
            guard
                let mediaId = dict["mediaId"] as? String,
                let rawType = dict["mediaType"] as? String,
                let mediaType = MediaType(rawValue: rawType)
            else { return nil }
            return ListItem(mediaId: mediaId, mediaType: mediaType, timestamp: dict["timestamp"] as? String)
        }

        let rawVisibility = data["visibility"] as? String ?? "public"
        let visibility = ListVisibility(rawValue: rawVisibility) ?? .publicList

        return CustomList(
            id: id,
            name: name,
            description: data["description"] as? String ?? "",
            visibility: visibility,
            items: items,
            createdAt: data["createdAt"] as? String
        )
    }

    func toFirestoreData() -> [String: Any] {
        [
            "name": name,
            "description": description,
            "visibility": visibility.rawValue,
            "items": items.map { $0.toDict() }
        ]
    }
}

struct ListItem: Identifiable, Hashable, Sendable {
    var id: String { "\(mediaType.rawValue)_\(mediaId)" }
    let mediaId: String
    let mediaType: MediaType
    let timestamp: String?

    // Enriched from TMDB (not stored in Firestore)
    var mediaItem: MediaItem?

    static func from(_ dict: [String: Any]) -> ListItem? {
        guard
            let mediaId = dict["mediaId"] as? String,
            let rawType = dict["mediaType"] as? String,
            let mediaType = MediaType(rawValue: rawType)
        else { return nil }
        return ListItem(
            mediaId: mediaId,
            mediaType: mediaType,
            timestamp: dict["timestamp"] as? String
        )
    }

    func toDict() -> [String: Any] {
        var d: [String: Any] = ["mediaId": mediaId, "mediaType": mediaType.rawValue]
        if let ts = timestamp { d["timestamp"] = ts }
        return d
    }
}
