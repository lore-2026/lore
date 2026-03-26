import SwiftUI

struct OnboardingView: View {
    @Bindable var authVM: AuthViewModel
    @State private var username = ""
    @State private var isSaving = false
    @State private var validationError: String?
    @State private var isCheckingUsername = false

    private let usernameRegex = /^[a-zA-Z0-9_]{3,20}$/

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text("Welcome to Lore")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(.white)
                    if let user = authVM.currentUser {
                        Text("Hi \(user.firstname)! Choose a username to get started.")
                            .font(.system(size: 16))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 60)

                Spacer()

                // Avatar placeholder
                ZStack {
                    Circle()
                        .fill(Color(hex: "#2b2a33"))
                        .frame(width: 100, height: 100)
                    if let user = authVM.currentUser, let url = user.photoURL, let imageUrl = URL(string: url) {
                        AsyncImage(url: imageUrl) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Text(user.initials)
                                .font(.system(size: 36, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .clipShape(Circle())
                        .frame(width: 100, height: 100)
                    } else if let user = authVM.currentUser {
                        Text(user.initials)
                            .font(.system(size: 36, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(.bottom, 32)

                // Username field
                VStack(alignment: .leading, spacing: 8) {
                    Text("Username")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.6))
                        .padding(.horizontal, 24)

                    HStack {
                        Text("@")
                            .foregroundStyle(.white.opacity(0.4))
                        TextField("yourname", text: $username)
                            .textFieldStyle(.plain)
                            .foregroundStyle(.white)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .onChange(of: username) { _, new in
                                validateUsername(new)
                            }
                        if isCheckingUsername {
                            ProgressView().scaleEffect(0.7).tint(.white)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(validationError != nil ? Color(hex: "#FF6B6B") : Color(hex: "#2a2930"), lineWidth: 1)
                    )
                    .padding(.horizontal, 24)

                    if let err = validationError {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(Color(hex: "#FF6B6B"))
                            .padding(.horizontal, 24)
                    } else {
                        Text("3–20 characters, letters, numbers and underscores only")
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.4))
                            .padding(.horizontal, 24)
                    }
                }

                Spacer()

                // Continue button
                Button(action: { Task { await save() } }) {
                    HStack {
                        if isSaving {
                            ProgressView().tint(Color(hex: "#141218")).scaleEffect(0.8)
                        }
                        Text(isSaving ? "Saving…" : "Continue")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color(hex: "#141218"))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(canContinue ? Color.white : Color.white.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 32))
                }
                .disabled(!canContinue || isSaving)
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            }
        }
    }

    private var canContinue: Bool {
        validationError == nil && username.count >= 3 && !isCheckingUsername
    }

    private func validateUsername(_ value: String) {
        guard !value.isEmpty else {
            validationError = nil
            return
        }
        guard value.count >= 3 else {
            validationError = "Must be at least 3 characters"
            return
        }
        guard value.count <= 20 else {
            validationError = "Must be 20 characters or fewer"
            return
        }
        guard value.wholeMatch(of: usernameRegex) != nil else {
            validationError = "Only letters, numbers and underscores"
            return
        }
        validationError = nil
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await authVM.completeOnboarding(username: username)
        } catch {
            validationError = error.localizedDescription
        }
    }
}
