import SwiftUI

struct LoginView: View {
    @Bindable var authVM: AuthViewModel

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var username = ""

    enum Mode { case signIn, signUp }

    private var usernameValid: Bool {
        let regex = /^[a-zA-Z0-9_]{3,20}$/
        return (try? regex.wholeMatch(in: username)) != nil
    }

    private var canSubmit: Bool {
        if email.isEmpty || password.isEmpty { return false }
        if mode == .signUp && !usernameValid { return false }
        return true
    }

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo + title
                VStack(spacing: 12) {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 72))
                        .foregroundStyle(.white)

                    Text("Lore")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Rate movies and shows.\nShare with friends.")
                        .font(.system(size: 16))
                        .foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                }

                Spacer()

                VStack(spacing: 16) {
                    if let error = authVM.error {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundStyle(Color(hex: "#FF6B6B"))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    // Fields
                    VStack(spacing: 10) {
                        if mode == .signUp {
                            TextField("Username", text: $username)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.white)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                                .background(Color(hex: "#1c1b21"))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(
                                    username.isEmpty ? Color(hex: "#2a2930") : (usernameValid ? Color(hex: "#2a2930") : Color(hex: "#FF6B6B")),
                                    lineWidth: 1
                                ))
                        }

                        TextField("Email", text: $email)
                            .textFieldStyle(.plain)
                            .foregroundStyle(.white)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(Color(hex: "#1c1b21"))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#2a2930"), lineWidth: 1))

                        SecureField("Password", text: $password)
                            .textFieldStyle(.plain)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(Color(hex: "#1c1b21"))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#2a2930"), lineWidth: 1))
                    }
                    .padding(.horizontal, 32)

                    // Primary action button
                    Button(action: {
                        Task {
                            if mode == .signIn {
                                await authVM.signInWithEmailOrUsername(emailOrUsername: email, password: password)
                            } else {
                                await authVM.createAccount(email: email, password: password, username: username)
                            }
                        }
                    }) {
                        HStack {
                            if authVM.isLoading {
                                ProgressView()
                                    .tint(Color(hex: "#141218"))
                                    .scaleEffect(0.8)
                            }
                            Text(authVM.isLoading ? "Please wait…" : (mode == .signIn ? "Sign in" : "Create account"))
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Color(hex: "#141218"))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                    }
                    .disabled(authVM.isLoading || !canSubmit)
                    .padding(.horizontal, 32)

                    // Divider
                    HStack {
                        Rectangle().fill(Color(hex: "#2a2930")).frame(height: 1)
                        Text("or").font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
                        Rectangle().fill(Color(hex: "#2a2930")).frame(height: 1)
                    }
                    .padding(.horizontal, 32)

                    // Google sign-in
                    Button(action: {
                        Task { await authVM.signInWithGoogle() }
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: "g.circle.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(.white)
                            Text("Continue with Google")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                        .overlay(RoundedRectangle(cornerRadius: 32).stroke(Color(hex: "#2a2930"), lineWidth: 1))
                    }
                    .disabled(authVM.isLoading)
                    .padding(.horizontal, 32)

                    // Toggle sign-in / sign-up
                    Button(action: {
                        authVM.error = nil
                        username = ""
                        mode = mode == .signIn ? .signUp : .signIn
                    }) {
                        Text(mode == .signIn ? "Don't have an account? Sign up" : "Already have an account? Sign in")
                            .font(.system(size: 14))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
                .padding(.bottom, 56)
            }
        }
    }
}
