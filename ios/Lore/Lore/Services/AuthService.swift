import Foundation
import AuthenticationServices

// MARK: - Auth errors

enum AuthError: Error, LocalizedError {
    case googleSignInFailed
    case firebaseSignInFailed
    case tokenExchangeFailed
    case userNotFound
    case networkError(Error)
    case emailAuthFailed(String)

    var errorDescription: String? {
        switch self {
        case .googleSignInFailed: return "Google sign-in was cancelled or failed"
        case .firebaseSignInFailed: return "Firebase authentication failed"
        case .tokenExchangeFailed: return "Failed to exchange token"
        case .userNotFound: return "User not found"
        case .networkError(let e): return e.localizedDescription
        case .emailAuthFailed(let msg): return msg
        }
    }
}

// MARK: - Auth credentials result

struct AuthCredentials {
    let uid: String
    let email: String
    let displayName: String
    let photoURL: String?
    let idToken: String
    let refreshToken: String
    let expiresIn: Int
    let isNewUser: Bool
}

// MARK: - AuthService

@MainActor
class AuthService: NSObject, ASWebAuthenticationPresentationContextProviding {

    static let shared = AuthService()
    private override init() { super.init() }

    // Stored in UserDefaults for session persistence
    private let defaults = UserDefaults.standard
    private let kRefreshToken = "lore.refreshToken"
    private let kUid = "lore.uid"

    var savedRefreshToken: String? {
        get { defaults.string(forKey: kRefreshToken) }
        set { defaults.set(newValue, forKey: kRefreshToken) }
    }

    var savedUid: String? {
        get { defaults.string(forKey: kUid) }
        set { defaults.set(newValue, forKey: kUid) }
    }

    // MARK: - Google Sign-In via ASWebAuthenticationSession

    func signInWithGoogle() async throws -> AuthCredentials {
        // Build Google OAuth2 URL
        let state = UUID().uuidString
        let nonce = UUID().uuidString

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: Config.googleClientId),
            URLQueryItem(name: "redirect_uri", value: "\(Config.googleRedirectScheme):/oauth2callback"),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "prompt", value: "select_account")
        ]

        guard let authURL = components.url else { throw AuthError.googleSignInFailed }
        guard let callbackScheme = URL(string: Config.googleRedirectScheme)?.scheme ?? Config.googleRedirectScheme.components(separatedBy: ":").first else {
            throw AuthError.googleSignInFailed
        }

        // Open Google sign-in page
        let callbackURL = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: callbackScheme
            ) { url, error in
                if let error { cont.resume(throwing: error) }
                else if let url { cont.resume(returning: url) }
                else { cont.resume(throwing: AuthError.googleSignInFailed) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        // Extract code from callback URL
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: true),
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value else {
            throw AuthError.googleSignInFailed
        }

        // Exchange code for tokens
        let googleTokens = try await exchangeGoogleCode(code: code)

        // Sign in to Firebase with Google ID token
        return try await signInToFirebase(with: googleTokens.idToken, accessToken: googleTokens.accessToken)
    }

    // MARK: - Token exchange

    private struct GoogleTokenResponse: Decodable {
        let idToken: String
        let accessToken: String
        let refreshToken: String?
        let expiresIn: Int

        enum CodingKeys: String, CodingKey {
            case idToken = "id_token"
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
        }
    }

    private func exchangeGoogleCode(code: String) async throws -> GoogleTokenResponse {
        guard let url = URL(string: Config.googleTokenBase) else { throw AuthError.tokenExchangeFailed }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "code": code,
            "client_id": Config.googleClientId,
            "redirect_uri": "\(Config.googleRedirectScheme):/oauth2callback",
            "grant_type": "authorization_code"
        ].map { "\($0.key)=\($0.value)" }.joined(separator: "&")

        req.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: req)
        let decoder = JSONDecoder()
        return try decoder.decode(GoogleTokenResponse.self, from: data)
    }

    private struct FirebaseSignInResponse: Decodable {
        let idToken: String
        let refreshToken: String
        let expiresIn: String
        let localId: String
        let email: String?
        let displayName: String?
        let photoUrl: String?
        let registered: Bool?

        enum CodingKeys: String, CodingKey {
            case idToken, refreshToken, expiresIn, localId, email, displayName, photoUrl, registered
        }
    }

    private func signInToFirebase(with googleIdToken: String, accessToken: String) async throws -> AuthCredentials {
        let urlStr = "\(Config.firebaseAuthBase)/accounts:signInWithIdp?key=\(Config.firebaseApiKey)"
        guard let url = URL(string: urlStr) else { throw AuthError.firebaseSignInFailed }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "requestUri": "http://localhost",
            "postBody": "id_token=\(googleIdToken)&access_token=\(accessToken)&providerId=google.com",
            "returnSecureToken": true,
            "returnIdpCredential": true
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { throw AuthError.firebaseSignInFailed }

        let decoded = try JSONDecoder().decode(FirebaseSignInResponse.self, from: data)
        let expiresIn = Int(decoded.expiresIn) ?? 3600

        // Parse display name into first/last (used in AuthViewModel.signInWithGoogle)

        let credentials = AuthCredentials(
            uid: decoded.localId,
            email: decoded.email ?? "",
            displayName: decoded.displayName ?? "",
            photoURL: decoded.photoUrl,
            idToken: decoded.idToken,
            refreshToken: decoded.refreshToken,
            expiresIn: expiresIn,
            isNewUser: decoded.registered == false
        )

        // Persist refresh token and uid
        savedRefreshToken = decoded.refreshToken
        savedUid = decoded.localId

        // Hydrate FirestoreService with token
        await FirestoreService.shared.setCredentials(
            idToken: decoded.idToken,
            refreshToken: decoded.refreshToken,
            expiresIn: expiresIn
        )

        return credentials
    }

    // MARK: - Email / Password Sign-In

    func signInWithEmail(email: String, password: String) async throws -> AuthCredentials {
        let urlStr = "\(Config.firebaseAuthBase)/accounts:signInWithPassword?key=\(Config.firebaseApiKey)"
        guard let url = URL(string: urlStr) else { throw AuthError.firebaseSignInFailed }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["email": email, "password": password, "returnSecureToken": true]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: req)
        if let status = (response as? HTTPURLResponse)?.statusCode, !(200...299).contains(status) {
            let msg = parseFirebaseError(data: data)
            throw AuthError.emailAuthFailed(msg)
        }

        return try await parseFirebaseSignInResponse(data: data, isNewUser: false)
    }

    // MARK: - Email / Password Create Account

    func createAccount(email: String, password: String) async throws -> AuthCredentials {
        let urlStr = "\(Config.firebaseAuthBase)/accounts:signUp?key=\(Config.firebaseApiKey)"
        guard let url = URL(string: urlStr) else { throw AuthError.firebaseSignInFailed }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["email": email, "password": password, "returnSecureToken": true]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: req)
        if let status = (response as? HTTPURLResponse)?.statusCode, !(200...299).contains(status) {
            let msg = parseFirebaseError(data: data)
            throw AuthError.emailAuthFailed(msg)
        }

        return try await parseFirebaseSignInResponse(data: data, isNewUser: true)
    }

    private func parseFirebaseSignInResponse(data: Data, isNewUser: Bool) async throws -> AuthCredentials {
        let decoded = try JSONDecoder().decode(FirebaseSignInResponse.self, from: data)
        let expiresIn = Int(decoded.expiresIn) ?? 3600

        savedRefreshToken = decoded.refreshToken
        savedUid = decoded.localId

        await FirestoreService.shared.setCredentials(
            idToken: decoded.idToken,
            refreshToken: decoded.refreshToken,
            expiresIn: expiresIn
        )

        return AuthCredentials(
            uid: decoded.localId,
            email: decoded.email ?? "",
            displayName: decoded.displayName ?? "",
            photoURL: decoded.photoUrl,
            idToken: decoded.idToken,
            refreshToken: decoded.refreshToken,
            expiresIn: expiresIn,
            isNewUser: isNewUser
        )
    }

    private func parseFirebaseError(data: Data) -> String {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = json["error"] as? [String: Any],
              let message = error["message"] as? String else {
            return "Authentication failed"
        }
        switch message {
        case "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS": return "Invalid email or password"
        case "WRONG_PASSWORD": return "Incorrect password"
        case "EMAIL_EXISTS": return "An account with this email already exists"
        case "WEAK_PASSWORD : Password should be at least 6 characters": return "Password must be at least 6 characters"
        case "INVALID_EMAIL": return "Invalid email address"
        case "TOO_MANY_ATTEMPTS_TRY_LATER": return "Too many attempts. Try again later."
        default: return message
        }
    }

    // MARK: - Restore session on launch

    func restoreSession() async throws -> String? {
        guard let refreshToken = savedRefreshToken, let uid = savedUid else { return nil }

        let urlStr = "\(Config.firebaseTokenBase)/token?key=\(Config.firebaseApiKey)"
        guard let url = URL(string: urlStr) else { return nil }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = "grant_type=refresh_token&refresh_token=\(refreshToken)".data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: req)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = json["id_token"] as? String,
              let newRefreshToken = json["refresh_token"] as? String,
              let expiresInStr = json["expires_in"] as? String,
              let expiresIn = Int(expiresInStr) else {
            return nil
        }

        savedRefreshToken = newRefreshToken

        await FirestoreService.shared.setCredentials(
            idToken: idToken,
            refreshToken: newRefreshToken,
            expiresIn: expiresIn
        )

        return uid
    }

    // MARK: - Sign out

    func signOut() {
        savedRefreshToken = nil
        savedUid = nil
        Task { await FirestoreService.shared.clearCredentials() }
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    // Called by ASWebAuthenticationSession on the main thread, so MainActor.assumeIsolated is safe.
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
#if os(iOS)
        MainActor.assumeIsolated {
            let windowScene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            if let scene = windowScene {
                return UIWindow(windowScene: scene)
            }
            return UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.windows.first }
                .first ?? UIWindow()
        }
#else
        NSApplication.shared.windows.first ?? NSWindow()
#endif
    }
}
