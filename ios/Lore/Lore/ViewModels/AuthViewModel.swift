import SwiftUI
import Observation

@Observable
@MainActor
class AuthViewModel {
    var currentUser: AppUser?
    var isLoading = true
    var error: String?

    private let db = FirestoreService.shared
    private let auth = AuthService.shared

    init() {
        Task { await restoreSession() }
    }

    // MARK: - Session restore on launch

    func restoreSession() async {
        isLoading = true
        defer { isLoading = false }

        do {
            if let uid = try await auth.restoreSession() {
                currentUser = try await fetchUser(uid: uid)
            }
        } catch {
            // No saved session or token expired → stay logged out
            currentUser = nil
        }
    }

    // MARK: - Google Sign-In

    func signInWithGoogle() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let creds = try await auth.signInWithGoogle()
            // Check if user doc exists
            if let (_, data) = try await db.getDocument(path: "users/\(creds.uid)"),
               let user = AppUser.from(id: creds.uid, data: data) as AppUser?,
               !user.username.isEmpty {
                currentUser = user
            } else {
                // New user — create stub and route to onboarding
                let nameParts = creds.displayName.components(separatedBy: " ")
                let firstname = nameParts.first ?? ""
                let lastname = nameParts.dropFirst().joined(separator: " ")
                currentUser = AppUser(
                    id: creds.uid,
                    firstname: firstname,
                    lastname: lastname,
                    email: creds.email,
                    photoURL: creds.photoURL
                )
                // Create user doc without username (triggers onboarding)
                try await db.setDocument(path: "users/\(creds.uid)", data: currentUser!.toFirestoreData())
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Email Sign-In

    func signInWithEmailOrUsername(emailOrUsername: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let creds = try await auth.signInWithEmail(email: emailOrUsername, password: password)
            if let (_, data) = try await db.getDocument(path: "users/\(creds.uid)"),
               let user = AppUser.from(id: creds.uid, data: data) as AppUser?,
               !user.username.isEmpty {
                currentUser = user
            } else {
                currentUser = AppUser(id: creds.uid, firstname: "", lastname: "", email: creds.email)
                try await db.setDocument(path: "users/\(creds.uid)", data: currentUser!.toFirestoreData())
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Email Sign-Up

    func createAccount(email: String, password: String, username: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            // Create Firebase Auth account first — this sets the auth token so
            // subsequent Firestore calls are authenticated (rules require auth).
            let creds = try await auth.createAccount(email: email, password: password)

            // Now check username availability
            if let _ = try await db.getDocument(path: "usernames/\(username.lowercased())") {
                self.error = "Username is already taken"
                return
            }

            var user = AppUser(id: creds.uid, firstname: "", lastname: "", email: creds.email)
            user.username = username.lowercased()

            try await db.commit(writes: [
                .init(kind: .set(path: "users/\(creds.uid)", data: user.toFirestoreData())),
                .init(kind: .set(path: "usernames/\(username.lowercased())", data: ["uid": creds.uid]))
            ])

            currentUser = user
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Onboarding: save username

    func completeOnboarding(username: String) async throws {
        guard var user = currentUser else { return }

        // Check availability
        if let _ = try await db.getDocument(path: "usernames/\(username)") {
            throw NSError(domain: "Lore", code: 409, userInfo: [NSLocalizedDescriptionKey: "Username is already taken"])
        }

        user.username = username
        let uid = user.id

        // Atomic batch: set user doc + username index
        try await db.commit(writes: [
            .init(kind: .set(path: "users/\(uid)", data: user.toFirestoreData())),
            .init(kind: .set(path: "usernames/\(username)", data: ["uid": uid]))
        ])

        currentUser = user
    }

    // MARK: - Update username

    func updateUsername(to newUsername: String) async throws {
        guard var user = currentUser else { return }
        let oldUsername = user.username
        let uid = user.id

        if let _ = try await db.getDocument(path: "usernames/\(newUsername)") {
            throw NSError(domain: "Lore", code: 409, userInfo: [NSLocalizedDescriptionKey: "Username is already taken"])
        }

        user.username = newUsername
        try await db.commit(writes: [
            .init(kind: .set(path: "users/\(uid)", data: user.toFirestoreData())),
            .init(kind: .set(path: "usernames/\(newUsername)", data: ["uid": uid])),
            .init(kind: .delete(path: "usernames/\(oldUsername)"))
        ])

        currentUser = user
    }

    // MARK: - Sign out

    func signOut() {
        auth.signOut()
        currentUser = nil
    }

    // MARK: - Helpers

    func fetchUser(uid: String) async throws -> AppUser? {
        guard let (id, data) = try await db.getDocument(path: "users/\(uid)") else { return nil }
        return AppUser.from(id: id, data: data)
    }

    var isLoggedIn: Bool { currentUser != nil }
    var needsOnboarding: Bool {
        guard let u = currentUser else { return false }
        return u.username.isEmpty
    }
}
