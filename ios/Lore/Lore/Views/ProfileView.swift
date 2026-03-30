import SwiftUI

struct ProfileView: View {
    let uid: String
    let isCurrentUser: Bool

    @State private var vm = ProfileViewModel()
    @Environment(AuthViewModel.self) private var authVM
    @State private var showFollowers = false
    @State private var showFollowing = false
    @State private var showEditUsername = false
    @State private var selectedTab = 0

    private let tabs = ["Lists", "Movies", "Shows", "Watchlist"]

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()

                if vm.isLoading {
                    ProgressView().tint(.white)
                } else if let user = vm.user {
                    ScrollView {
                        VStack(spacing: 0) {
                            // Header
                            ProfileHeaderView(
                                user: user,
                                isCurrentUser: isCurrentUser,
                                vm: vm,
                                showFollowers: $showFollowers,
                                showFollowing: $showFollowing,
                                showEditUsername: $showEditUsername
                            )

                            // Tabs
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 0) {
                                    ForEach(Array(tabs.enumerated()), id: \.offset) { idx, name in
                                        Button(action: { selectedTab = idx }) {
                                            VStack(spacing: 0) {
                                                Text(name)
                                                    .font(.system(size: 14, weight: selectedTab == idx ? .semibold : .regular))
                                                    .foregroundStyle(selectedTab == idx ? .white : .white.opacity(0.5))
                                                    .padding(.horizontal, 16)
                                                    .padding(.vertical, 12)
                                                Rectangle()
                                                    .fill(selectedTab == idx ? Color.white : Color.clear)
                                                    .frame(height: 2)
                                            }
                                        }
                                    }
                                }
                            }
                            .background(Color(hex: "#1c1b21"))

                            // Tab content
                            Group {
                                switch selectedTab {
                                case 0: ListsTabView(vm: vm, uid: uid, isOwner: isCurrentUser)
                                case 1: RatingsTabView(ratings: vm.movieRatings, mediaType: .movie)
                                case 2: RatingsTabView(ratings: vm.showRatings, mediaType: .tv)
                                case 3: WatchlistTabView(vm: vm, uid: uid)
                                default: EmptyView()
                                }
                            }
                            .padding(.top, 16)
                        }
                    }
                }
            }
            .navigationTitle(isCurrentUser ? "Profile" : (vm.user?.fullName ?? ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: "#141218"), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                if isCurrentUser {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: { authVM.signOut() }) {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .foregroundStyle(.white.opacity(0.7))
                        }
                    }
                } else {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: {
                            if let currentUid = authVM.currentUser?.id {
                                Task { await vm.toggleFollow(targetUid: uid, currentUid: currentUid) }
                            }
                        }) {
                            Text(vm.isFollowing ? "Unfollow" : "Follow")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(vm.isFollowing ? .white.opacity(0.7) : Color(hex: "#141218"))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                                .background(vm.isFollowing ? Color(hex: "#2b2a33") : Color.white)
                                .clipShape(Capsule())
                        }
                    }
                }
            }
            .task { await vm.loadProfile(uid: uid, currentUid: authVM.currentUser?.id) }
            .onChange(of: selectedTab) { _, new in
                Task {
                    switch new {
                    case 0: await vm.loadListsIfNeeded(uid: uid, isOwner: isCurrentUser)
                    case 1, 2: await vm.loadRatingsIfNeeded(uid: uid)
                    case 3: await vm.loadWatchlistIfNeeded(uid: uid)
                    default: break
                    }
                }
            }
            .sheet(isPresented: $showFollowers) {
                SocialListSheet(title: "Followers", users: vm.followerUsers)
                    .task { await vm.loadFollowers() }
            }
            .sheet(isPresented: $showFollowing) {
                SocialListSheet(title: "Following", users: vm.followingUsers)
                    .task { await vm.loadFollowing() }
            }
            .sheet(isPresented: $showEditUsername) {
                if isCurrentUser {
                    EditUsernameSheet(authVM: authVM)
                }
            }
        }
    }
}

// MARK: - Profile header

private struct ProfileHeaderView: View {
    let user: AppUser
    let isCurrentUser: Bool
    @Bindable var vm: ProfileViewModel
    @Binding var showFollowers: Bool
    @Binding var showFollowing: Bool
    @Binding var showEditUsername: Bool

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 16) {
                AvatarView(user: user, size: 72)

                VStack(alignment: .leading, spacing: 4) {
                    Text(user.fullName)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)

                    HStack(spacing: 4) {
                        Text("@\(user.username)")
                            .font(.system(size: 14))
                            .foregroundStyle(.white.opacity(0.5))
                        if isCurrentUser {
                            Button(action: { showEditUsername = true }) {
                                Image(systemName: "pencil")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.white.opacity(0.4))
                            }
                        }
                    }
                }

                Spacer()

                // Share button
                Button(action: {
                    let url = "https://lore.app/user?uid=\(user.id)"
                    UIPasteboard.general.string = url
                }) {
                    Image(systemName: "square.and.arrow.up")
                        .foregroundStyle(.white.opacity(0.6))
                }
            }

            // Stats
            HStack(spacing: 0) {
                StatView(value: user.ratingCount, label: "Ratings")
                Divider().frame(height: 24).background(Color(hex: "#2a2930"))
                StatView(value: user.followerlist.count, label: "Followers") {
                    showFollowers = true
                }
                Divider().frame(height: 24).background(Color(hex: "#2a2930"))
                StatView(value: user.followinglist.count, label: "Following") {
                    showFollowing = true
                }
            }
            .padding(.vertical, 4)
        }
        .padding(16)
    }
}

private struct StatView: View {
    let value: Int
    let label: String
    var action: (() -> Void)? = nil

    var body: some View {
        Button(action: { action?() }) {
            VStack(spacing: 2) {
                Text("\(value)")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                Text(label)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
            }
            .frame(maxWidth: .infinity)
        }
        .disabled(action == nil)
    }
}

// MARK: - Tab views

private struct ListsTabView: View {
    @Bindable var vm: ProfileViewModel
    let uid: String
    let isOwner: Bool
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        LazyVStack(spacing: 12) {
            ForEach(vm.customLists) { list in
                NavigationLink(destination: ListDetailView(listId: list.id, uid: uid)) {
                    ListRowView(list: list)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .task { await vm.loadListsIfNeeded(uid: uid, isOwner: isOwner) }
    }
}

private struct ListRowView: View {
    let list: CustomList

    var body: some View {
        HStack(spacing: 12) {
            // Placeholder grid preview
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(hex: "#2b2a33"))
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: "film.stack")
                        .foregroundStyle(.white.opacity(0.4))
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(list.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                Text("\(list.items.count) items · \(list.visibility.displayName)")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.3))
        }
        .padding(12)
        .background(Color(hex: "#1c1b21"))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct RatingsTabView: View {
    let ratings: [RatingEntry]
    let mediaType: MediaType

    var body: some View {
        if ratings.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: mediaType == .movie ? "film" : "tv")
                    .font(.system(size: 36))
                    .foregroundStyle(.white.opacity(0.3))
                Text("No \(mediaType.displayName.lowercased()) ratings yet")
                    .foregroundStyle(.white.opacity(0.5))
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(Array(ratings.enumerated()), id: \.element.docId) { idx, rating in
                    NavigationLink(destination: DetailsView(mediaId: rating.mediaId, mediaType: mediaType)) {
                        RatingRowView(rank: idx + 1, rating: rating)
                    }
                    .buttonStyle(.plain)
                    Divider().background(Color(hex: "#2a2930")).padding(.leading, 52)
                }
            }
        }
    }
}

private struct RatingRowView: View {
    let rank: Int
    let rating: RatingEntry

    var body: some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.4))
                .frame(width: 24, alignment: .trailing)

            VStack(alignment: .leading, spacing: 2) {
                Text(rating.mediaName ?? "Unknown")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                Text(rating.sentiment.displayName)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
            }

            Spacer()

            if let score = rating.displayScore {
                Text(String(format: "%.1f", score))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

private struct WatchlistTabView: View {
    @Bindable var vm: ProfileViewModel
    let uid: String

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(vm.watchlistItems) { item in
                if let media = item.mediaItem {
                    NavigationLink(destination: DetailsView(mediaId: media.id, mediaType: media.mediaType)) {
                        MediaRowViewFromItem(item: media)
                    }
                    .buttonStyle(.plain)
                    Divider().background(Color(hex: "#2a2930")).padding(.leading, 76)
                }
            }
        }
        .task { await vm.loadWatchlistIfNeeded(uid: uid) }
    }
}

private struct MediaRowViewFromItem: View {
    let item: MediaItem

    var body: some View {
        HStack(spacing: 12) {
            PosterThumbnail(path: item.posterPath)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                if let year = item.releaseYear {
                    Text(year).font(.system(size: 13)).foregroundStyle(.white.opacity(0.5))
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - Social list sheet

struct SocialListSheet: View {
    let title: String
    let users: [AppUser]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()
                List(users) { user in
                    NavigationLink(destination: ProfileView(uid: user.id, isCurrentUser: false)) {
                        ProfileRowView(user: user)
                    }
                    .listRowBackground(Color(hex: "#1c1b21"))
                }
                .listStyle(.plain)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Edit username sheet

struct EditUsernameSheet: View {
    @Bindable var authVM: AuthViewModel
    @State private var newUsername = ""
    @State private var isSaving = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private let usernameRegex = /^[a-zA-Z0-9_]{3,20}$/

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()
                VStack(alignment: .leading, spacing: 16) {
                    TextField("New username", text: $newUsername)
                        .textFieldStyle(.plain)
                        .foregroundStyle(.white)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(14)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#2a2930")))

                    if let err = error {
                        Text(err).font(.system(size: 13)).foregroundStyle(Color(hex: "#FF6B6B"))
                    }

                    Spacer()
                }
                .padding(24)
            }
            .navigationTitle("Edit Username")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task {
                            isSaving = true
                            do {
                                try await authVM.updateUsername(to: newUsername)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                            isSaving = false
                        }
                    }
                    .disabled(newUsername.count < 3 || isSaving)
                }
            }
        }
    }
}
