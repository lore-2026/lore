import Foundation

// MARK: - Errors

enum FirestoreError: Error, LocalizedError {
    case invalidURL
    case noToken
    case networkError(Error)
    case serverError(Int, String)
    case decodingError(Error)
    case notFound

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .noToken: return "Not authenticated"
        case .networkError(let e): return e.localizedDescription
        case .serverError(let code, let msg): return "Server error \(code): \(msg)"
        case .decodingError(let e): return "Decoding error: \(e.localizedDescription)"
        case .notFound: return "Document not found"
        }
    }
}

// MARK: - Firestore value codec

nonisolated enum FSCodec {
    // MARK: - Encode Swift → Firestore value format

    static func encode(_ value: Any?) -> [String: Any] {
        guard let value else { return ["nullValue": "NULL_VALUE"] }
        switch value {
        case let s as String:
            return ["stringValue": s]
        case let i as Int:
            return ["integerValue": "\(i)"]
        case let d as Double:
            return ["doubleValue": d]
        case let b as Bool:
            return ["booleanValue": b]
        case let arr as [Any]:
            return ["arrayValue": ["values": arr.map { encode($0) }]]
        case let dict as [String: Any]:
            return ["mapValue": ["fields": dict.mapValues { encode($0) }]]
        default:
            return ["nullValue": "NULL_VALUE"]
        }
    }

    static func encodeDocument(_ data: [String: Any]) -> [String: Any] {
        ["fields": data.mapValues { encode($0) }]
    }

    // MARK: - Decode Firestore value format → Swift

    static func decode(_ value: Any?) -> Any? {
        guard let dict = value as? [String: Any] else { return nil }
        if let s = dict["stringValue"] as? String { return s }
        if let i = dict["integerValue"] as? String { return Int(i) }
        if let d = dict["doubleValue"] as? Double { return d }
        if let b = dict["booleanValue"] as? Bool { return b }
        if dict["nullValue"] != nil { return nil }
        if let arr = dict["arrayValue"] as? [String: Any],
           let values = arr["values"] as? [Any] {
            return values.compactMap { decode($0) }
        }
        if let map = dict["mapValue"] as? [String: Any],
           let fields = map["fields"] as? [String: Any] {
            return fields.compactMapValues { decode($0) }
        }
        if let ts = dict["timestampValue"] as? String { return ts }
        return nil
    }

    static func decodeDocument(_ raw: [String: Any]) -> (id: String, data: [String: Any]) {
        let name = raw["name"] as? String ?? ""
        let docId = name.components(separatedBy: "/").last ?? name
        let fields = raw["fields"] as? [String: Any] ?? [:]
        let data = fields.compactMapValues { decode($0) }
        return (docId, data)
    }
}

// MARK: - FirestoreService

actor FirestoreService {
    static let shared = FirestoreService()
    private init() {}

    private var idToken: String?
    private var refreshToken: String?
    private var tokenExpiry: Date?

    func setCredentials(idToken: String, refreshToken: String, expiresIn: Int) {
        self.idToken = idToken
        self.refreshToken = refreshToken
        self.tokenExpiry = Date().addingTimeInterval(TimeInterval(expiresIn - 60))
    }

    func clearCredentials() {
        idToken = nil
        refreshToken = nil
        tokenExpiry = nil
    }

    // MARK: - Token management

    private func validToken() async throws -> String {
        if let expiry = tokenExpiry, Date() > expiry, let rt = refreshToken {
            try await refreshIdToken(using: rt)
        }
        guard let token = idToken else { throw FirestoreError.noToken }
        return token
    }

    private func refreshIdToken(using refreshToken: String) async throws {
        guard let url = URL(string: "\(Config.firebaseTokenBase)/token?key=\(Config.firebaseApiKey)") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = "grant_type=refresh_token&refresh_token=\(refreshToken)".data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: req)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let newIdToken = json["id_token"] as? String,
              let newRefreshToken = json["refresh_token"] as? String,
              let expiresInStr = json["expires_in"] as? String,
              let expiresIn = Int(expiresInStr) else {
            throw FirestoreError.decodingError(NSError(domain: "FSToken", code: 0))
        }
        self.idToken = newIdToken
        self.refreshToken = newRefreshToken
        self.tokenExpiry = Date().addingTimeInterval(TimeInterval(expiresIn - 60))
    }

    // MARK: - CRUD

    func getDocument(path: String) async throws -> (id: String, data: [String: Any])? {
        let token = try await validToken()
        guard let url = URL(string: "\(Config.firestoreBase)/\(path)") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { return nil }
        guard status == 200 else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw FirestoreError.decodingError(NSError(domain: "FS", code: 0))
        }
        return FSCodec.decodeDocument(json)
    }

    func setDocument(path: String, data: [String: Any]) async throws {
        let token = try await validToken()
        guard let url = URL(string: "\(Config.firestoreBase)/\(path)") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: FSCodec.encodeDocument(data))

        let (respData, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: respData, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }
    }

    func updateDocument(path: String, fields: [String: Any], mask: [String]? = nil) async throws {
        let token = try await validToken()
        var urlStr = "\(Config.firestoreBase)/\(path)"
        if let mask {
            let maskParams = mask.map { "updateMask.fieldPaths=\($0)" }.joined(separator: "&")
            urlStr += "?\(maskParams)"
        }
        guard let url = URL(string: urlStr) else { throw FirestoreError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: FSCodec.encodeDocument(fields))

        let (respData, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: respData, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }
    }

    func deleteDocument(path: String) async throws {
        let token = try await validToken()
        guard let url = URL(string: "\(Config.firestoreBase)/\(path)") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (respData, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: respData, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }
    }

    func addDocument(collectionPath: String, data: [String: Any]) async throws -> String {
        let token = try await validToken()
        guard let url = URL(string: "\(Config.firestoreBase)/\(collectionPath)") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: FSCodec.encodeDocument(data))

        let (respData, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: respData, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }
        guard let json = try JSONSerialization.jsonObject(with: respData) as? [String: Any],
              let name = json["name"] as? String else {
            throw FirestoreError.decodingError(NSError(domain: "FS", code: 0))
        }
        return name.components(separatedBy: "/").last ?? name
    }

    // MARK: - Collection query

    struct QueryFilter {
        let field: String
        let op: String          // e.g. "EQUAL", "GREATER_THAN_OR_EQUAL"
        let value: Any
    }

    func queryCollection(
        path: String,
        filters: [QueryFilter] = [],
        orderBy: String? = nil,
        descending: Bool = false,
        limit: Int? = nil
    ) async throws -> [(id: String, data: [String: Any])] {
        let token = try await validToken()
        // Build structured query
        var queryBody: [String: Any] = [:]
        var structuredQuery: [String: Any] = [
            "from": [["collectionId": path.components(separatedBy: "/").last ?? path]]
        ]

        if !filters.isEmpty {
            let fsFilters: [[String: Any]] = filters.map { f in
                [
                    "fieldFilter": [
                        "field": ["fieldPath": f.field],
                        "op": f.op,
                        "value": FSCodec.encode(f.value)
                    ]
                ]
            }
            if fsFilters.count == 1 {
                structuredQuery["where"] = fsFilters[0]
            } else {
                structuredQuery["where"] = [
                    "compositeFilter": [
                        "op": "AND",
                        "filters": fsFilters
                    ]
                ]
            }
        }

        if let orderBy {
            structuredQuery["orderBy"] = [[
                "field": ["fieldPath": orderBy],
                "direction": descending ? "DESCENDING" : "ASCENDING"
            ]]
        }

        if let limit { structuredQuery["limit"] = limit }
        queryBody["structuredQuery"] = structuredQuery

        // The parent for the query
        let parentPath = "projects/\(Config.firebaseProjectId)/databases/(default)/documents"
        let collParts = path.components(separatedBy: "/")
        let parent: String
        if collParts.count > 1 {
            parent = parentPath + "/" + collParts.dropLast().joined(separator: "/")
        } else {
            parent = parentPath
        }

        guard let url = URL(string: "https://firestore.googleapis.com/v1/\(parent):runQuery") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: queryBody)

        let (respData, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: respData, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }

        guard let results = try JSONSerialization.jsonObject(with: respData) as? [[String: Any]] else {
            return []
        }

        return results.compactMap { result -> (id: String, data: [String: Any])? in
            guard let doc = result["document"] as? [String: Any] else { return nil }
            return FSCodec.decodeDocument(doc)
        }
    }

    // MARK: - Atomic operations (commit)

    struct WriteOp {
        enum Kind {
            case set(path: String, data: [String: Any])
            case delete(path: String)
            case arrayUnion(path: String, field: String, values: [Any])
            case arrayRemove(path: String, field: String, values: [Any])
            case increment(path: String, field: String, amount: Int)
        }
        let kind: Kind
    }

    func commit(writes: [WriteOp]) async throws {
        let token = try await validToken()
        guard let url = URL(string: "https://firestore.googleapis.com/v1/projects/\(Config.firebaseProjectId)/databases/(default)/documents:commit") else {
            throw FirestoreError.invalidURL
        }

        var fsWrites: [[String: Any]] = []
        let basePath = "projects/\(Config.firebaseProjectId)/databases/(default)/documents"

        for op in writes {
            switch op.kind {
            case .set(let path, let data):
                fsWrites.append([
                    "update": [
                        "name": "\(basePath)/\(path)",
                        "fields": (data.mapValues { FSCodec.encode($0) })
                    ]
                ])
            case .delete(let path):
                fsWrites.append(["delete": "\(basePath)/\(path)"])
            case .arrayUnion(let path, let field, let values):
                fsWrites.append([
                    "transform": [
                        "document": "\(basePath)/\(path)",
                        "fieldTransforms": [[
                            "fieldPath": field,
                            "appendMissingElements": ["values": values.map { FSCodec.encode($0) }]
                        ]]
                    ]
                ])
            case .arrayRemove(let path, let field, let values):
                fsWrites.append([
                    "transform": [
                        "document": "\(basePath)/\(path)",
                        "fieldTransforms": [[
                            "fieldPath": field,
                            "removeAllFromArray": ["values": values.map { FSCodec.encode($0) }]
                        ]]
                    ]
                ])
            case .increment(let path, let field, let amount):
                fsWrites.append([
                    "transform": [
                        "document": "\(basePath)/\(path)",
                        "fieldTransforms": [[
                            "fieldPath": field,
                            "increment": FSCodec.encode(amount)
                        ]]
                    ]
                ])
            }
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["writes": fsWrites])

        let (respData, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            let body = String(data: respData, encoding: .utf8) ?? ""
            throw FirestoreError.serverError(status, body)
        }
    }

    // MARK: - List subcollection

    func listDocuments(path: String) async throws -> [(id: String, data: [String: Any])] {
        let token = try await validToken()
        guard let url = URL(string: "\(Config.firestoreBase)/\(path)") else {
            throw FirestoreError.invalidURL
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { return [] }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let docs = json["documents"] as? [[String: Any]] else {
            return []
        }
        return docs.map { FSCodec.decodeDocument($0) }
    }
}
