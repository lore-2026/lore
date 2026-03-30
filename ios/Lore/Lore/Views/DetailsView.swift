import SwiftUI

struct DetailsView: View {
    let mediaId: Int
    let mediaType: MediaType

    @State private var vm = DetailsViewModel()
    @Environment(AuthViewModel.self) private var authVM
    @State private var showAddToList = false
    @State private var showRatingFlow = false

    init(mediaId: Int, mediaType: MediaType) {
        self.mediaId = mediaId
        self.mediaType = mediaType
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundColor = UIColor(red: 0x14/255, green: 0x12/255, blue: 0x18/255, alpha: 1)
        appearance.backButtonAppearance.normal.backgroundImage = UIImage()
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: "#141218").ignoresSafeArea()

            if vm.isLoading {
                ProgressView().tint(.white)
            } else if let media = vm.mediaItem {
                // Backdrop pinned behind status bar
                BackdropView(media: media)

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        HeroSection(media: media, vm: vm, showAddToList: $showAddToList)

                        // Overview, genres, runtime
                        MediaMetadataView(media: media)
                            .padding(.horizontal, 16)
                            .padding(.top, 16)

                        // Rating area — "Add rating" CTA or inline score display
                        if vm.phase == .done {
                            DoneRatingView(vm: vm, media: media)
                                .padding(.horizontal, 16)
                                .padding(.top, 20)
                        } else {
                            Button(action: { showRatingFlow = true }) {
                                Text("Add rating")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color(hex: "#141218"))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(Color.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 32))
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 20)
                        }

                        // Discussion (only available after rating)
                        if vm.phase == .done {
                            let mediaKey = "\(mediaType.rawValue)_\(mediaId)"
                            DiscussionSectionView(
                                mediaKey: mediaKey,
                                mediaTitle: media.title,
                                userScore: vm.myRating?.displayScore
                            )
                            .padding(.top, 32)
                        }

                        Spacer(minLength: 40)
                    }
                }
            } else if let error = vm.error {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundStyle(.white.opacity(0.4))
                    Text(error)
                        .foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                }
                .padding()
            }

            // Back button overlaid directly — avoids iOS 26 toolbar glass effect
            BackButtonView(title: vm.mediaItem?.title)
                .padding(.top, 8)
                .padding(.leading, 16)
        }
        .navigationBarHidden(true)
        .task {
            if let user = authVM.currentUser {
                await vm.load(mediaType: mediaType, mediaId: mediaId, currentUser: user)
            }
        }
        .sheet(isPresented: $showAddToList) {
            if let user = authVM.currentUser {
                AddToListSheet(
                    mediaId: "\(mediaId)",
                    mediaType: mediaType,
                    currentUser: user
                )
            }
        }
        .fullScreenCover(isPresented: $showRatingFlow, onDismiss: { vm.resetRatingFlow() }) {
            RatingFlowView(vm: vm)
        }
    }
}

// MARK: - Hero

private struct BackdropView: View {
    let media: MediaItem
    private let backdropHeight: CGFloat = 320

    var body: some View {
        if let urlStr = media.backdropUrl(size: "w780"),
           let url = URL(string: urlStr) {
            GeometryReader { geo in
                AsyncImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: backdropHeight)
                        .clipped()
                } placeholder: {
                    Color.clear
                }
            }
            .frame(height: backdropHeight)
            .opacity(0.25)
            .mask(
                VStack(spacing: 0) {
                    Color.white
                    LinearGradient(
                        colors: [.white, .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: backdropHeight * 0.25)
                }
            )
            .ignoresSafeArea(edges: .top)
        }
    }
}

private struct HeroSection: View {
    let media: MediaItem
    @Bindable var vm: DetailsViewModel
    @Binding var showAddToList: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: 52)

            ZStack(alignment: .topTrailing) {
                Group {
                    if let url = URL(string: media.posterUrl(size: "w342")) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: { Color(hex: "#2b2a33") }
                    } else {
                        Color(hex: "#2b2a33")
                    }
                }
                .frame(width: 160, height: 235)
                .clipShape(RoundedRectangle(cornerRadius: 10))

                Button(action: { showAddToList = true }) {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Color(hex: "#141218").opacity(0.8))
                        .clipShape(Circle())
                }
                .padding(6)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 20)
        }
    }
}

// MARK: - Done view (existing rating)

private struct DoneRatingView: View {
    @Bindable var vm: DetailsViewModel
    let media: MediaItem
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        VStack(spacing: 12) {
            if let rating = vm.myRating {
                // Note
                if let note = rating.note, !note.isEmpty {
                    Text(note)
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(3)
                }

                // Score cards
                RatingScoreCards(vm: vm, myRating: rating)
            }
        }
    }
}

// MARK: - Rating score cards

private struct RatingScoreCards: View {
    let vm: DetailsViewModel
    let myRating: RatingEntry

    var body: some View {
        HStack(spacing: 10) {
            ScoreCard(
                label: "Your rating",
                score: myRating.displayScore ?? myRating.score
            )

            ScoreCard(
                label: "Friends",
                score: RatingsEngine.average(scores: vm.friendsRatings.values.compactMap {
                    $0.displayScore ?? $0.score
                })
            )

            ScoreCard(
                label: "Community",
                score: vm.communityAverage
            )
        }
    }
}

private struct ScoreCard: View {
    let label: String
    let score: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.5))

            Text(score.map { String(format: "%.1f", $0) } ?? "—")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background {
            BlurView(style: .systemThinMaterialDark)
                .opacity(0.6)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(hex: "#2a2930"), lineWidth: 1)
        )
    }
}

private struct BlurView: UIViewRepresentable {
    let style: UIBlurEffect.Style
    func makeUIView(context: Context) -> UIVisualEffectView {
        UIVisualEffectView(effect: UIBlurEffect(style: style))
    }
    func updateUIView(_ uiView: UIVisualEffectView, context: Context) {}
}

// MARK: - Media metadata (certification, year, genres, runtime)

private struct MediaMetadataView: View {
    let media: MediaItem
    @State private var overviewExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Metadata line
            let parts = metadataParts
            if !parts.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
                        if index == 0, media.certification != nil {
                            // Certification badge
                            Text(part)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white.opacity(0.6))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 3)
                                        .stroke(.white.opacity(0.3), lineWidth: 1)
                                )
                        } else {
                            if index > 0 {
                                Text("·")
                                    .foregroundStyle(.white.opacity(0.4))
                                    .font(.system(size: 13))
                            }
                            Text(part)
                                .font(.system(size: 13))
                                .foregroundStyle(.white.opacity(0.6))
                        }
                    }
                }
            }

            // Overview
            if !media.overview.isEmpty {
                Text(media.overview)
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(overviewExpanded ? nil : 4)
                    .onTapGesture { overviewExpanded.toggle() }
                    .animation(.easeInOut(duration: 0.2), value: overviewExpanded)
            }
        }
    }

    private var metadataParts: [String] {
        var parts: [String] = []
        if let cert = media.certification, !cert.isEmpty {
            parts.append(cert)
        }
        if let year = media.releaseYear {
            parts.append(year)
        }
        if !media.genres.isEmpty {
            parts.append(media.genres.prefix(2).joined(separator: "/"))
        }
        if let runtime = media.runtime, runtime > 0 {
            let hours = runtime / 60
            let mins = runtime % 60
            if hours > 0 {
                parts.append("\(hours)h \(mins)m")
            } else {
                parts.append("\(mins)m")
            }
        }
        if let seasons = media.numberOfSeasons {
            parts.append("\(seasons) season\(seasons == 1 ? "" : "s")")
        }
        return parts
    }
}

// MARK: - Add to list sheet

struct AddToListSheet: View {
    let mediaId: String
    let mediaType: MediaType
    let currentUser: AppUser

    @State private var vm = ProfileViewModel()
    @State private var showCreate = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            listPickerView
                .navigationDestination(isPresented: $showCreate) {
                    CreateListView(
                        mediaId: mediaId,
                        mediaType: mediaType,
                        currentUser: currentUser,
                        vm: vm,
                        onCreated: { dismiss() }
                    )
                }
        }
        .task {
            await vm.loadListsIfNeeded(uid: currentUser.id, isOwner: true)
        }
    }

    // Synthetic watchlist entry built from the user's watchlist array
    private var watchlistEntry: CustomList {
        let items = currentUser.watchlist.map {
            ListItem(mediaId: $0.mediaId, mediaType: $0.mediaType, timestamp: $0.timestamp)
        }
        return CustomList(id: "watchlist", name: "Watchlist", description: "", visibility: .publicList, items: items)
    }

    private var allLists: [CustomList] {
        [watchlistEntry] + vm.customLists
    }

    private var listPickerView: some View {
        ZStack(alignment: .bottom) {
            Color(hex: "#141218").ignoresSafeArea()

            VStack(spacing: 0) {
                // Drag indicator
                Capsule()
                    .fill(Color.white.opacity(0.25))
                    .frame(width: 36, height: 4)
                    .padding(.top, 10)
                    .padding(.bottom, 6)

                Group {
                    if vm.isLoading {
                        ProgressView().tint(.white)
                            .frame(maxHeight: .infinity)
                    } else {
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(allLists) { list in
                                    ListPickerRow(
                                        list: list,
                                        mediaId: mediaId,
                                        mediaType: mediaType
                                    ) {
                                        Task {
                                            if list.id == "watchlist" {
                                                await vm.toggleWatchlist(
                                                    mediaId: mediaId,
                                                    mediaType: mediaType,
                                                    currentUser: currentUser
                                                )
                                            } else {
                                                try? await vm.addItemToList(
                                                    listId: list.id,
                                                    mediaId: mediaId,
                                                    mediaType: mediaType,
                                                    ownerUid: currentUser.id
                                                )
                                            }
                                            dismiss()
                                        }
                                    }
                                    Divider()
                                        .background(Color(hex: "#2a2930"))
                                }
                                Color.clear.frame(height: 96)
                            }
                        }
                    }
                }
            }

            // Pinned CTA
            VStack(spacing: 0) {
                Button(action: { showCreate = true }) {
                    Text("Add to new list")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color(hex: "#141218"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 34)
            }
            .background(Color(hex: "#141218"))
        }
        .navigationBarHidden(true)
    }
}

private struct ListPickerRow: View {
    let list: CustomList
    let mediaId: String
    let mediaType: MediaType
    let onTap: () -> Void

    @State private var posterURLs: [URL?] = []

    private var isAlreadyAdded: Bool {
        list.items.contains { $0.mediaId == mediaId && $0.mediaType == mediaType }
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(list.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                        if !list.description.isEmpty {
                            Text(list.description)
                                .font(.system(size: 13))
                                .foregroundStyle(.white.opacity(0.45))
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    if isAlreadyAdded {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.45))
                    }
                }

                if !list.items.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 5) {
                            ForEach(Array(list.items.prefix(8).enumerated()), id: \.offset) { idx, _ in
                                Group {
                                    if idx < posterURLs.count, let url = posterURLs[idx] {
                                        AsyncImage(url: url) { phase in
                                            if case .success(let img) = phase {
                                                img.resizable().scaledToFill()
                                            } else {
                                                Color(hex: "#2b2a33")
                                            }
                                        }
                                    } else {
                                        Color(hex: "#2b2a33")
                                    }
                                }
                                .frame(width: 46, height: 68)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .buttonStyle(.plain)
        .task(id: list.id) {
            let items = Array(list.items.prefix(8))
            var urls: [URL?] = Array(repeating: nil, count: items.count)
            posterURLs = urls
            await withTaskGroup(of: (Int, URL?).self) { group in
                for (idx, item) in items.enumerated() {
                    group.addTask {
                        guard let id = Int(item.mediaId),
                              let media = try? await TMDBService.shared.fetchDetails(
                                  mediaType: item.mediaType, id: id),
                              let path = media.posterPath
                        else { return (idx, nil) }
                        return (idx, URL(string: "\(Config.tmdbImageBase)/w185\(path)"))
                    }
                }
                for await (idx, url) in group {
                    urls[idx] = url
                }
            }
            posterURLs = urls
        }
    }
}

private struct CreateListView: View {
    let mediaId: String
    let mediaType: MediaType
    let currentUser: AppUser
    @Bindable var vm: ProfileViewModel
    let onCreated: () -> Void

    @State private var name = ""
    @State private var description = ""
    @State private var visibility: ListVisibility = .publicList
    @State private var isSaving = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Button(action: { dismiss() }) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    Spacer()
                    Text("Create new list")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)
                    Spacer()
                    Color.clear.frame(width: 20)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 24)

                VStack(spacing: 12) {
                    // Name field
                    TextField("Name", text: $name)
                        .textFieldStyle(.plain)
                        .foregroundStyle(.white)
                        .tint(.white)
                        .padding(16)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    // Description field
                    TextField("Description", text: $description, axis: .vertical)
                        .textFieldStyle(.plain)
                        .foregroundStyle(.white)
                        .tint(.white)
                        .lineLimit(4, reservesSpace: true)
                        .padding(16)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    // Public / Private toggle
                    HStack(spacing: 0) {
                        ForEach(ListVisibility.allCases, id: \.self) { option in
                            Button(action: { visibility = option }) {
                                Text(option.displayName)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        visibility == option
                                            ? Color(hex: "#2b2a33")
                                            : Color.clear
                                    )
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.horizontal, 20)

                Spacer()

                // Pinned CTA
                Button(action: {
                    guard !name.isEmpty, !isSaving else { return }
                    isSaving = true
                    Task {
                        do {
                            try await vm.createList(
                                name: name,
                                description: description,
                                visibility: visibility,
                                ownerUid: currentUser.id
                            )
                            // Add the media to the newly created list
                            if let newList = vm.customLists.last {
                                try await vm.addItemToList(
                                    listId: newList.id,
                                    mediaId: mediaId,
                                    mediaType: mediaType,
                                    ownerUid: currentUser.id
                                )
                            }
                            onCreated()
                        } catch {
                            isSaving = false
                        }
                    }
                }) {
                    Group {
                        if isSaving {
                            ProgressView().tint(Color(hex: "#141218"))
                        } else {
                            Text("Create and add")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Color(hex: "#141218"))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(name.isEmpty ? Color.white.opacity(0.35) : Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 32))
                }
                .disabled(name.isEmpty || isSaving)
                .padding(.horizontal, 16)
                .padding(.bottom, 34)
            }
        }
        .navigationBarHidden(true)
    }
}

private struct BackButtonView: View {
    let title: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button(action: { dismiss() }) {
            HStack(spacing: 4) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 23, weight: .semibold))
                if let title {
                    Text(title)
                        .font(.system(size: 23, weight: .semibold))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
    }
}
