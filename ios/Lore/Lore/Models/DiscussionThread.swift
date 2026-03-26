import Foundation

struct DiscussionThread: Identifiable, Hashable {
    let id: String
    let uid: String
    var username: String
    var photoURL: String?
    var text: String
    var voteCount: Int
    var upvoterUids: [String]
    var replyCount: Int
    let createdAt: Date
    var userScore: Double?

    var replies: [ThreadReply] = []
    var isExpanded: Bool = false

    func hasUpvoted(uid: String) -> Bool {
        upvoterUids.contains(uid)
    }

    static func from(id: String, data: [String: Any]) -> DiscussionThread? {
        guard
            let uid = data["uid"] as? String,
            let text = data["text"] as? String
        else { return nil }

        let createdAt: Date
        if let ts = data["createdAt"] as? Double {
            createdAt = Date(timeIntervalSince1970: ts)
        } else if let tsStr = data["createdAt"] as? String,
                  let ts = Double(tsStr) {
            createdAt = Date(timeIntervalSince1970: ts)
        } else {
            createdAt = Date()
        }

        let score: Double?
        if let s = data["userScore"] as? Double { score = s }
        else if let s = data["userScore"] as? Int { score = Double(s) }
        else { score = nil }

        return DiscussionThread(
            id: id,
            uid: uid,
            username: data["username"] as? String ?? "unknown",
            photoURL: data["photoURL"] as? String,
            text: text,
            voteCount: data["voteCount"] as? Int ?? 0,
            upvoterUids: data["upvoterUids"] as? [String] ?? [],
            replyCount: data["replyCount"] as? Int ?? 0,
            createdAt: createdAt,
            userScore: score
        )
    }

    func toFirestoreData(currentUser: AppUser, userScore: Double?) -> [String: Any] {
        var d: [String: Any] = [
            "uid": uid,
            "username": currentUser.username,
            "text": text,
            "voteCount": 0,
            "upvoterUids": [],
            "replyCount": 0,
            "createdAt": Date().timeIntervalSince1970
        ]
        if let url = currentUser.photoURL { d["photoURL"] = url }
        if let score = userScore { d["userScore"] = score }
        return d
    }
}

struct ThreadReply: Identifiable, Hashable {
    let id: String
    let uid: String
    var username: String
    var photoURL: String?
    var text: String
    var voteCount: Int
    var upvoterUids: [String]
    let createdAt: Date
    var userScore: Double?

    func hasUpvoted(uid: String) -> Bool {
        upvoterUids.contains(uid)
    }

    static func from(id: String, data: [String: Any]) -> ThreadReply? {
        guard
            let uid = data["uid"] as? String,
            let text = data["text"] as? String
        else { return nil }

        let createdAt: Date
        if let ts = data["createdAt"] as? Double {
            createdAt = Date(timeIntervalSince1970: ts)
        } else {
            createdAt = Date()
        }

        let score: Double?
        if let s = data["userScore"] as? Double { score = s }
        else if let s = data["userScore"] as? Int { score = Double(s) }
        else { score = nil }

        return ThreadReply(
            id: id,
            uid: uid,
            username: data["username"] as? String ?? "unknown",
            photoURL: data["photoURL"] as? String,
            text: text,
            voteCount: data["voteCount"] as? Int ?? 0,
            upvoterUids: data["upvoterUids"] as? [String] ?? [],
            createdAt: createdAt,
            userScore: score
        )
    }

    func toFirestoreData(currentUser: AppUser, userScore: Double?) -> [String: Any] {
        var d: [String: Any] = [
            "uid": uid,
            "username": currentUser.username,
            "text": text,
            "voteCount": 0,
            "upvoterUids": [],
            "createdAt": Date().timeIntervalSince1970
        ]
        if let url = currentUser.photoURL { d["photoURL"] = url }
        if let score = userScore { d["userScore"] = score }
        return d
    }
}
