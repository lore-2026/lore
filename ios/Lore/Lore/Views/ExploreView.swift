import SwiftUI

struct ExploreView: View {
    @State private var vm = ExploreViewModel()
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        // Search bar
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass")
                                .foregroundStyle(.white.opacity(0.5))
                            TextField("Search movies, shows, people…", text: $vm.query)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.white)
                                .autocorrectionDisabled()
                                .onChange(of: vm.query) { _, new in
                                    vm.onQueryChange(new)
                                }
                            if !vm.query.isEmpty {
                                Button(action: { vm.query = "" }) {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.white.opacity(0.5))
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 16)

                        // Filter chips
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(ExploreFilter.allCases) { f in
                                    FilterChip(title: f.rawValue, isSelected: vm.filter == f) {
                                        vm.filter = f
                                        if !vm.query.isEmpty {
                                            Task { await vm.performSearch(query: vm.query) }
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                        }

                        if vm.showingSearchResults {
                            SearchResultsSection(vm: vm)
                        } else {
                            TrendingSection(vm: vm)
                        }
                    }
                    .padding(.top, 16)
                }
            }
            .navigationTitle("Explore")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color(hex: "#141218"), for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .task { await vm.loadTrending() }
        }
    }
}

// MARK: - Search Results

private struct SearchResultsSection: View {
    @Bindable var vm: ExploreViewModel
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if vm.isSearching {
                HStack { Spacer(); ProgressView().tint(.white); Spacer() }
                    .padding(.top, 40)
            } else if vm.mediaResults.isEmpty && vm.profileResults.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 40))
                        .foregroundStyle(.white.opacity(0.3))
                    Text("No results for \"\(vm.query)\"")
                        .foregroundStyle(.white.opacity(0.5))
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 60)
            } else {
                // Media results
                if !vm.mediaResults.isEmpty && (vm.filter == .all || vm.filter == .movies || vm.filter == .shows) {
                    LazyVStack(spacing: 0) {
                        ForEach(vm.mediaResults, id: \.id) { result in
                            NavigationLink(destination: DetailsView(
                                mediaId: result.id,
                                mediaType: result.resolvedMediaType ?? .movie
                            )) {
                                MediaRowView(result: result)
                            }
                            .buttonStyle(.plain)
                            Divider().background(Color(hex: "#2a2930")).padding(.leading, 76)
                        }
                    }
                }

                // Profile results
                if !vm.profileResults.isEmpty && (vm.filter == .all || vm.filter == .profiles) {
                    if !vm.mediaResults.isEmpty { sectionHeader("People") }
                    LazyVStack(spacing: 0) {
                        ForEach(vm.profileResults) { user in
                            NavigationLink(destination: ProfileView(uid: user.id, isCurrentUser: false)) {
                                ProfileRowView(user: user)
                            }
                            .buttonStyle(.plain)
                            Divider().background(Color(hex: "#2a2930")).padding(.leading, 76)
                        }
                    }
                }
            }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white.opacity(0.5))
            .textCase(.uppercase)
            .padding(.horizontal, 16)
    }
}

// MARK: - Trending Section

private struct TrendingSection: View {
    @Bindable var vm: ExploreViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if vm.isLoadingTrending {
                HStack { Spacer(); ProgressView().tint(.white); Spacer() }
            } else {
                if !vm.trendingMovies.isEmpty {
                    MediaRow(title: "Trending Movies", items: vm.trendingMovies)
                }
                if !vm.trendingShows.isEmpty {
                    MediaRow(title: "Trending Shows", items: vm.trendingShows)
                }
            }
        }
    }
}

private struct MediaRow: View {
    let title: String
    let items: [MediaItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in
                        NavigationLink(destination: DetailsView(mediaId: item.id, mediaType: item.mediaType)) {
                            MediaCardView(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

// MARK: - Row cells

struct MediaRowView: View {
    let result: TMDBSearchResult

    var body: some View {
        HStack(spacing: 12) {
            PosterThumbnail(path: result.posterPath, size: "w92")
            VStack(alignment: .leading, spacing: 4) {
                Text(result.resolvedTitle)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let year = result.resolvedYear {
                        Text(year).foregroundStyle(.white.opacity(0.5))
                    }
                    if let type = result.resolvedMediaType {
                        Text("·").foregroundStyle(.white.opacity(0.3))
                        Text(type.displayName).foregroundStyle(.white.opacity(0.5))
                    }
                }
                .font(.system(size: 13))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.3))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

struct ProfileRowView: View {
    let user: AppUser

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(user: user, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.fullName)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                Text("@\(user.username)")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.3))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - Filter chip

struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? Color(hex: "#141218") : .white)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isSelected ? Color.white : Color(hex: "#2b2a33"))
                .clipShape(Capsule())
        }
    }
}

// MARK: - Poster thumbnail

struct PosterThumbnail: View {
    let path: String?
    var size: String = "w92"

    var body: some View {
        Group {
            if let path, let url = URL(string: "\(Config.tmdbImageBase)/\(size)\(path)") {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    posterPlaceholder
                }
            } else {
                posterPlaceholder
            }
        }
        .frame(width: 44, height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private var posterPlaceholder: some View {
        Color(hex: "#2b2a33")
    }
}

// MARK: - Avatar view

struct AvatarView: View {
    let user: AppUser
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle()
                .fill(gradientColor(for: user.id))
                .frame(width: size, height: size)

            if let urlStr = user.photoURL, let url = URL(string: urlStr) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsView
                }
                .clipShape(Circle())
                .frame(width: size, height: size)
            } else {
                initialsView
            }
        }
    }

    private var initialsView: some View {
        Text(user.initials)
            .font(.system(size: size * 0.35, weight: .semibold))
            .foregroundStyle(.white)
    }

    private func gradientColor(for uid: String) -> Color {
        let colors: [Color] = [
            Color(hex: "#5B4FCF"), Color(hex: "#CF4F4F"), Color(hex: "#4FCF7A"),
            Color(hex: "#CF9E4F"), Color(hex: "#4F9FCF"), Color(hex: "#CF4F9E")
        ]
        let idx = abs(uid.hashValue) % colors.count
        return colors[idx]
    }
}
