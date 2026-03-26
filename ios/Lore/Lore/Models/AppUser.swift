import Foundation

struct AppUser: Identifiable, Hashable, Sendable {
    let id: String          // Firestore uid
    var firstname: String
    var lastname: String
    var username: String
    var email: String
    var photoURL: String?
    var ratingCount: Int
    var followerlist: [String]
    var followinglist: [String]
    var watchlist: [WatchlistItem]
    var isDeveloper: Bool

    var initials: String {
        let f = firstname.first.map(String.init) ?? ""
        let l = lastname.first.map(String.init) ?? ""
        return (f + l).uppercased()
    }

    var fullName: String { "\(firstname) \(lastname)".trimmingCharacters(in: .whitespaces) }
    var fullNameLower: String { fullName.lowercased() }

    init(
        id: String,
        firstname: String = "",
        lastname: String = "",
        username: String = "",
        email: String = "",
        photoURL: String? = nil,
        ratingCount: Int = 0,
        followerlist: [String] = [],
        followinglist: [String] = [],
        watchlist: [WatchlistItem] = [],
        isDeveloper: Bool = false
    ) {
        self.id = id
        self.firstname = firstname
        self.lastname = lastname
        self.username = username
        self.email = email
        self.photoURL = photoURL
        self.ratingCount = ratingCount
        self.followerlist = followerlist
        self.followinglist = followinglist
        self.watchlist = watchlist
        self.isDeveloper = isDeveloper
    }

    // MARK: - Firestore parsing

    static func from(id: String, data: [String: Any]) -> AppUser {
        let lists = data["lists"] as? [String: Any]
        let rawWatchlist = lists?["watchlist"] as? [[String: Any]] ?? []
        let watchlist: [WatchlistItem] = rawWatchlist.compactMap { dict in
            guard
                let mediaId = dict["mediaId"] as? String,
                let rawType = dict["mediaType"] as? String,
                let mediaType = MediaType(rawValue: rawType)
            else { return nil }
            return WatchlistItem(mediaId: mediaId, mediaType: mediaType, timestamp: dict["timestamp"] as? String)
        }

        return AppUser(
            id: id,
            firstname: data["firstname"] as? String ?? "",
            lastname: data["lastname"] as? String ?? "",
            username: data["username"] as? String ?? "",
            email: data["email"] as? String ?? "",
            photoURL: data["photoURL"] as? String,
            ratingCount: data["ratingCount"] as? Int ?? 0,
            followerlist: data["followerlist"] as? [String] ?? [],
            followinglist: data["followinglist"] as? [String] ?? [],
            watchlist: watchlist,
            isDeveloper: data["isDeveloper"] as? Bool ?? false
        )
    }

    func toFirestoreData() -> [String: Any] {
        [
            "firstname": firstname,
            "lastname": lastname,
            "fullNameLower": fullNameLower,
            "username": username,
            "email": email,
            "photoURL": photoURL as Any,
            "ratingCount": ratingCount,
            "isDeveloper": isDeveloper,
            "followerlist": followerlist,
            "followinglist": followinglist,
            "lists": [
                "watchlist": watchlist.map { $0.toDict() }
            ]
        ]
    }
}

struct WatchlistItem: Identifiable, Hashable, Sendable {
    var id: String { "\(mediaType.rawValue)_\(mediaId)" }
    let mediaId: String
    let mediaType: MediaType
    let timestamp: String?

    static func from(_ dict: [String: Any]) -> WatchlistItem? {
        guard
            let mediaId = dict["mediaId"] as? String,
            let rawType = dict["mediaType"] as? String,
            let mediaType = MediaType(rawValue: rawType)
        else { return nil }
        return WatchlistItem(
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
