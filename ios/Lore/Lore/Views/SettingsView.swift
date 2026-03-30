import SwiftUI

struct SettingsView: View {
    @Bindable var authVM: AuthViewModel
    @State private var selectedTab = 0

    private let tabs = ["Account", "Data"]

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()

                VStack(spacing: 0) {
                    // Tab picker
                    Picker("Settings", selection: $selectedTab) {
                        ForEach(Array(tabs.enumerated()), id: \.offset) { idx, name in
                            Text(name).tag(idx)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(16)

                    // Tab content
                    ScrollView {
                        switch selectedTab {
                        case 0: AccountTab(authVM: authVM)
                        case 1: DataTab(authVM: authVM)
                        default: EmptyView()
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color(hex: "#141218"), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

// MARK: - Account tab

private struct AccountTab: View {
    @Bindable var authVM: AuthViewModel

    var body: some View {
        VStack(spacing: 16) {
            if let user = authVM.currentUser {
                // Profile info card
                VStack(spacing: 12) {
                    AvatarView(user: user, size: 64)
                    Text(user.fullName)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("@\(user.username)")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.5))
                    Text(user.email)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.4))
                }
                .frame(maxWidth: .infinity)
                .padding(20)
                .background(Color(hex: "#1c1b21"))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16)
            }

            Text("More account options coming soon.")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.4))
                .padding(.top, 8)

            // Sign out
            Button(action: { authVM.signOut() }) {
                HStack {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                    Text("Sign Out")
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color(hex: "#FF6B6B"))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color(hex: "#FF6B6B").opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#FF6B6B").opacity(0.3)))
                .padding(.horizontal, 16)
            }

            // Dev-only section
            if authVM.currentUser?.isDeveloper == true {
                DeveloperSection(authVM: authVM)
            }
        }
        .padding(.top, 8)
    }
}

// MARK: - Data tab

private struct DataTab: View {
    @Bindable var authVM: AuthViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Letterboxd import placeholder
            VStack(alignment: .leading, spacing: 12) {
                Text("Import from Letterboxd")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Export your Letterboxd data and import your ratings into Lore. Go to letterboxd.com/settings/data to export.")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.6))

                // File picker
                Text("CSV import is available via the web app at lore.app/settings")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.4))
                    .padding(12)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(16)
            .background(Color(hex: "#1c1b21"))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)

            Spacer()
        }
        .padding(.top, 8)
    }
}

// MARK: - Developer section

private struct DeveloperSection: View {
    @Bindable var authVM: AuthViewModel
    @State private var showDeleteRatingsConfirm = false
    @State private var showDeleteAccountConfirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Developer")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.4))
                .textCase(.uppercase)
                .padding(.horizontal, 16)

            VStack(spacing: 8) {
                Button(action: { showDeleteRatingsConfirm = true }) {
                    HStack {
                        Image(systemName: "trash.circle")
                        Text("Delete all ratings")
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: "#FF6B6B"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.horizontal, 16)
                }

                Button(action: { showDeleteAccountConfirm = true }) {
                    HStack {
                        Image(systemName: "person.badge.minus")
                        Text("Delete account")
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: "#FF6B6B"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.horizontal, 16)
                }
            }
        }
        .alert("Delete all ratings?", isPresented: $showDeleteRatingsConfirm) {
            Button("Delete", role: .destructive) { Task { await deleteAllRatings() } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Delete account?", isPresented: $showDeleteAccountConfirm) {
            Button("Delete", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete your account and all data.")
        }
    }

    private func deleteAllRatings() async {
        guard let uid = authVM.currentUser?.id else { return }
        let db = FirestoreService.shared
        // Delete all rating docs
        let ratings = (try? await db.listDocuments(path: "users/\(uid)/ratings")) ?? []
        var writes: [FirestoreService.WriteOp] = ratings.map { .init(kind: .delete(path: "users/\(uid)/ratings/\($0.id)")) }
        writes.append(.init(kind: .set(path: "users/\(uid)", data: ["ratingCount": 0])))
        try? await db.commit(writes: writes)
    }

    private func deleteAccount() async {
        guard let uid = authVM.currentUser?.id,
              let username = authVM.currentUser?.username else { return }
        let db = FirestoreService.shared
        try? await db.commit(writes: [
            .init(kind: .delete(path: "users/\(uid)")),
            .init(kind: .delete(path: "usernames/\(username)"))
        ])
        authVM.signOut()
    }
}
