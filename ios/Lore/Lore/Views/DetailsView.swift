import SwiftUI

struct DetailsView: View {
    let mediaId: Int
    let mediaType: MediaType

    @State private var vm = DetailsViewModel()
    @Environment(AuthViewModel.self) private var authVM
    @State private var showAddToList = false

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            if vm.isLoading {
                ProgressView().tint(.white)
            } else if let media = vm.mediaItem {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // Hero section
                        HeroSection(media: media, vm: vm, showAddToList: $showAddToList)

                        // Rating section
                        RatingSectionView(vm: vm, media: media)
                            .padding(.horizontal, 16)
                            .padding(.top, 24)

                        // Discussion
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
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(hex: "#141218"), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
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
    }
}

// MARK: - Hero

private struct HeroSection: View {
    let media: MediaItem
    @Bindable var vm: DetailsViewModel
    @Binding var showAddToList: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // Poster
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
                .frame(width: 120, height: 175)
                .clipShape(RoundedRectangle(cornerRadius: 8))

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

            // Info
            VStack(alignment: .leading, spacing: 6) {
                Text(media.title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                HStack(spacing: 8) {
                    if let year = media.releaseYear { Text(year) }
                    if let runtime = media.runtime { Text("·"); Text("\(runtime) min") }
                    if let seasons = media.numberOfSeasons { Text("·"); Text("\(seasons) seasons") }
                }
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.5))

                if !media.genres.isEmpty {
                    Text(media.genres.prefix(3).joined(separator: " · "))
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.5))
                }

                // Community average
                if let avg = vm.communityAverage {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 11))
                        Text(String(format: "%.1f", avg))
                            .font(.system(size: 13, weight: .semibold))
                        Text("(\(vm.communityCount))")
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .foregroundStyle(.white)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)

        // Overview
        if !media.overview.isEmpty {
            Text(media.overview)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.7))
                .lineLimit(4)
                .padding(.horizontal, 16)
                .padding(.top, 12)
        }
    }
}

// MARK: - Rating section

private struct RatingSectionView: View {
    @Bindable var vm: DetailsViewModel
    let media: MediaItem
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        VStack(spacing: 16) {
            switch vm.phase {
            case .initial:
                InitialRatingView(vm: vm, media: media)
            case .comparing:
                ComparisonView(vm: vm)
            case .done:
                DoneRatingView(vm: vm, media: media)
            }
        }
    }
}

// MARK: - Initial rating (sentiment picker)

private struct InitialRatingView: View {
    @Bindable var vm: DetailsViewModel
    let media: MediaItem
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Rate this")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)

            // Sentiment buttons
            HStack(spacing: 8) {
                ForEach(Sentiment.allCases, id: \.self) { sentiment in
                    SentimentButton(
                        sentiment: sentiment,
                        isSelected: vm.selectedSentiment == sentiment,
                        action: { vm.selectedSentiment = sentiment }
                    )
                }
            }

            // Season picker (TV only)
            if media.mediaType == .tv, let seasons = media.seasons, !seasons.isEmpty {
                Menu {
                    Button("Whole show") { vm.selectedSeason = nil }
                    ForEach(seasons) { season in
                        Button("Season \(season.seasonNumber)") {
                            vm.selectedSeason = season.seasonNumber
                        }
                    }
                } label: {
                    HStack {
                        Text(vm.selectedSeason.map { "Season \($0)" } ?? "Whole show")
                            .foregroundStyle(.white)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#2a2930")))
                }
            }

            // Note field
            VStack(alignment: .leading, spacing: 6) {
                Text("Add a note (optional)")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))
                TextField("What did you think?", text: $vm.note, axis: .vertical)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .lineLimit(3, reservesSpace: true)
                    .padding(12)
                    .background(Color(hex: "#1c1b21"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#2a2930")))
            }

            // Next button
            Button(action: {
                guard let user = authVM.currentUser,
                      let sentiment = vm.selectedSentiment else { return }
                vm.startRating(
                    sentiment: sentiment,
                    season: vm.selectedSeason,
                    existingRatings: vm.allMyRatings,
                    uid: user.id
                )
            }) {
                Text("Next")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(vm.selectedSentiment != nil ? Color(hex: "#141218") : Color(hex: "#141218").opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(vm.selectedSentiment != nil ? Color.white : Color.white.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 32))
            }
            .disabled(vm.selectedSentiment == nil)
        }
        .padding(16)
        .background(Color(hex: "#1c1b21"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct SentimentButton: View {
    let sentiment: Sentiment
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(sentiment.emoji)
                    .font(.system(size: 24))
                Text(sentiment.displayName)
                    .font(.system(size: 11))
                    .foregroundStyle(isSelected ? Color(hex: "#141218") : .white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(isSelected ? Color.white : Color(hex: "#2b2a33"))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Comparison view (binary sort)

private struct ComparisonView: View {
    @Bindable var vm: DetailsViewModel
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        VStack(spacing: 16) {
            Text("Which did you like more?")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)

            if let comp = vm.comparison, let compEntry = comp.currentComparison {
                HStack(spacing: 12) {
                    // Current (new) item
                    ComparisonCard(
                        title: vm.mediaItem?.title ?? "",
                        subtitle: "New rating",
                        action: {
                            if let uid = authVM.currentUser?.id {
                                vm.compareChoice(preferNewItem: true, uid: uid)
                            }
                        }
                    )

                    Text("vs")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.5))

                    // Comparison item
                    ComparisonCard(
                        title: compEntry.mediaName ?? "Unknown",
                        subtitle: String(format: "%.1f", compEntry.displayScore ?? compEntry.score),
                        action: {
                            if let uid = authVM.currentUser?.id {
                                vm.compareChoice(preferNewItem: false, uid: uid)
                            }
                        }
                    )
                }

                Button(action: {
                    if let uid = authVM.currentUser?.id {
                        vm.skipComparison(uid: uid)
                    }
                }) {
                    Text("Skip")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
        }
        .padding(16)
        .background(Color(hex: "#1c1b21"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct ComparisonCard: View {
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
            }
            .frame(maxWidth: .infinity)
            .padding(12)
            .background(Color(hex: "#2b2a33"))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Done view (existing rating)

private struct DoneRatingView: View {
    @Bindable var vm: DetailsViewModel
    let media: MediaItem
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Text("Your rating")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()

                HStack(spacing: 8) {
                    Button(action: {
                        vm.phase = .initial
                        vm.selectedSentiment = vm.myRating?.sentiment
                    }) {
                        Image(systemName: "arrow.counterclockwise")
                            .foregroundStyle(.white.opacity(0.6))
                    }

                    Button(action: {
                        if let uid = authVM.currentUser?.id {
                            Task { await vm.deleteRating(uid: uid) }
                        }
                    }) {
                        Image(systemName: "trash")
                            .foregroundStyle(Color(hex: "#FF6B6B").opacity(0.8))
                    }
                }
            }

            if let rating = vm.myRating {
                HStack(spacing: 16) {
                    // Score
                    VStack(spacing: 4) {
                        Text(String(format: "%.1f", rating.displayScore ?? rating.score))
                            .font(.system(size: 36, weight: .bold))
                            .foregroundStyle(.white)
                        Text(rating.sentiment.displayName)
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .frame(width: 80)
                    .padding(.vertical, 12)
                    .background(Color(hex: "#2b2a33"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 8) {
                        if let note = rating.note, !note.isEmpty {
                            Text(note)
                                .font(.system(size: 14))
                                .foregroundStyle(.white.opacity(0.8))
                                .lineLimit(3)
                        }
                        if !vm.friendsRatings.isEmpty {
                            let avg = RatingsEngine.average(scores: vm.friendsRatings.values.compactMap {
                                $0.displayScore ?? $0.score
                            })
                            if let avg {
                                Text("Friends avg: \(String(format: "%.1f", avg))")
                                    .font(.system(size: 13))
                                    .foregroundStyle(.white.opacity(0.5))
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .background(Color(hex: "#1c1b21"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Add to list sheet

struct AddToListSheet: View {
    let mediaId: String
    let mediaType: MediaType
    let currentUser: AppUser
    @State private var vm = ProfileViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()
                VStack {
                    if vm.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Add to list functionality")
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
            }
            .navigationTitle("Add to List")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
