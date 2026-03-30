import Foundation

// MARK: - ActivityEntry

struct ActivityEntry: Identifiable, Hashable, Sendable {
    let id: String
    let uid: String
    let username: String
    let photoURL: String?
    let mediaId: String
    let mediaType: MediaType
    let mediaName: String
    let posterPath: String?
    let sentiment: Sentiment
    let note: String?
    let season: Int?
    let createdAt: Date
    let mediaKey: String         // e.g. "movie_123" — used to build the thread path
    let threadId: String?        // non-nil only when the rating had a note (linked discussion thread)
    var voteCount: Int           // mirrors the linked thread's voteCount
    var upvoterUids: [String]    // mirrors the linked thread's upvoterUids
    var commentCount: Int

    func hasUpvoted(uid: String) -> Bool {
        upvoterUids.contains(uid)
    }

    static func from(id: String, data: [String: Any]) -> ActivityEntry? {
        guard
            let uid = data["uid"] as? String,
            let username = data["username"] as? String,
            let mediaId = data["mediaId"] as? String,
            let rawType = data["mediaType"] as? String,
            let mediaType = MediaType(rawValue: rawType),
            let mediaName = data["mediaName"] as? String,
            let rawSentiment = data["sentiment"] as? String,
            let sentiment = Sentiment(rawValue: rawSentiment)
        else { return nil }

        let mediaKey = data["mediaKey"] as? String
            ?? "\(mediaType.rawValue)_\(mediaId)"   // fallback for older docs

        return ActivityEntry(
            id: id,
            uid: uid,
            username: username,
            photoURL: data["photoURL"] as? String,
            mediaId: mediaId,
            mediaType: mediaType,
            mediaName: mediaName,
            posterPath: data["posterPath"] as? String,
            sentiment: sentiment,
            note: data["note"] as? String,
            season: data["season"] as? Int,
            createdAt: parseActivityTimestamp(data["createdAt"]) ?? Date(),
            mediaKey: mediaKey,
            threadId: data["threadId"] as? String,
            voteCount: data["voteCount"] as? Int ?? 0,
            upvoterUids: (data["upvoterUids"] as? [Any])?.compactMap { $0 as? String } ?? [],
            commentCount: data["commentCount"] as? Int ?? 0
        )
    }

    func toFirestoreData() -> [String: Any] {
        let iso = ISO8601DateFormatter()
        var d: [String: Any] = [
            "uid": uid,
            "username": username,
            "mediaId": mediaId,
            "mediaType": mediaType.rawValue,
            "mediaName": mediaName,
            "sentiment": sentiment.rawValue,
            "createdAt": iso.string(from: createdAt),
            "mediaKey": mediaKey,
            "voteCount": voteCount,
            "upvoterUids": upvoterUids,
            "commentCount": commentCount
        ]
        if let p = photoURL   { d["photoURL"]   = p }
        if let p = posterPath { d["posterPath"] = p }
        if let n = note       { d["note"]        = n }
        if let s = season     { d["season"]      = s }
        if let t = threadId   { d["threadId"]    = t }
        return d
    }
}

// MARK: - ActivityComment

struct ActivityComment: Identifiable, Hashable, Sendable {
    let id: String
    let uid: String
    let username: String
    let photoURL: String?
    let text: String
    let createdAt: Date

    static func from(id: String, data: [String: Any]) -> ActivityComment? {
        guard
            let uid = data["uid"] as? String,
            let username = data["username"] as? String,
            let text = data["text"] as? String
        else { return nil }

        return ActivityComment(
            id: id,
            uid: uid,
            username: username,
            photoURL: data["photoURL"] as? String,
            text: text,
            createdAt: parseActivityTimestamp(data["createdAt"]) ?? Date()
        )
    }

    func toFirestoreData() -> [String: Any] {
        let iso = ISO8601DateFormatter()
        var d: [String: Any] = [
            "uid": uid,
            "username": username,
            "text": text,
            "createdAt": iso.string(from: createdAt)
        ]
        if let p = photoURL { d["photoURL"] = p }
        return d
    }
}

// MARK: - Timestamp parser

private func parseActivityTimestamp(_ value: Any?) -> Date? {
    guard let str = value as? String else { return nil }
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = fmt.date(from: str) { return d }
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.date(from: str)
}
