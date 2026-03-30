import SwiftUI

struct ActivityCardView: View {
    let entry: ActivityEntry
    @Bindable var vm: HomeViewModel
    let currentUser: AppUser

    @State private var resolvedPosterPath: String? = nil
    private let tmdb = TMDBService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                headerView
                mediaRowView
                actionRowView
            }
            .padding(16)

            if vm.expandedComments.contains(entry.id) {
                Divider().background(Color(hex: "#2a2930"))
                commentsSectionView
                    .padding(16)
            }
        }
        .background(Color(hex: "#141218"))
    }

    // MARK: - Header

    private var headerView: some View {
        HStack(alignment: .top, spacing: 10) {
            NavigationLink(destination: ProfileView(uid: entry.uid, isCurrentUser: entry.uid == currentUser.id)) {
                AvatarView(
                    user: AppUser(id: entry.uid, firstname: entry.username, photoURL: entry.photoURL),
                    size: 36
                )
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 0) {
                    NavigationLink(destination: ProfileView(uid: entry.uid, isCurrentUser: entry.uid == currentUser.id)) {
                        Text("@\(entry.username)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Text(entry.createdAt.feedTimeAgo)
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.4))
                }

                NavigationLink(destination: DetailsView(mediaId: Int(entry.mediaId) ?? 0, mediaType: entry.mediaType)) {
                    HStack(spacing: 4) {
                        Text("rated")
                            .foregroundStyle(.white.opacity(0.5))
                        Text(entry.mediaName)
                            .foregroundStyle(.white)
                        if let season = entry.season {
                            Text("· S\(season)")
                                .foregroundStyle(.white.opacity(0.5))
                        }
                    }
                    .font(.system(size: 13))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Media row

    private var mediaRowView: some View {
        HStack(alignment: .top, spacing: 12) {
            NavigationLink(destination: DetailsView(mediaId: Int(entry.mediaId) ?? 0, mediaType: entry.mediaType)) {
                posterView
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 8) {
                sentimentBadge

                if let note = entry.note, !note.isEmpty {
                    Text(note)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.75))
                        .lineLimit(3)
                }
            }
        }
    }

    private var posterView: some View {
        Group {
            let path = entry.posterPath ?? resolvedPosterPath
            if let path,
               let urlStr = tmdb.posterUrl(path, size: "w185"),
               let url = URL(string: urlStr) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color(hex: "#2b2a33")
                }
            } else {
                Color(hex: "#2b2a33")
            }
        }
        .frame(width: 54, height: 80)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: entry.id) {
            guard entry.posterPath == nil, resolvedPosterPath == nil,
                  let mediaId = Int(entry.mediaId) else { return }
            if let cached = vm.cachedPosterPath(mediaKey: entry.mediaKey) {
                resolvedPosterPath = cached
            } else if let media = try? await tmdb.fetchDetails(mediaType: entry.mediaType, id: mediaId) {
                resolvedPosterPath = media.posterPath
                vm.cachePosterPath(mediaKey: entry.mediaKey, path: media.posterPath)
            }
        }
    }

    private var sentimentBadge: some View {
        Text(entry.sentiment.displayName)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(entry.sentiment.feedBadgeColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(entry.sentiment.feedBadgeColor.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    // MARK: - Action row

    private var actionRowView: some View {
        HStack(spacing: 20) {
            // Upvote — only shown when the activity is linked to a discussion thread
            if entry.threadId != nil {
                Button(action: {
                    Task { await vm.toggleUpvote(activityId: entry.id, currentUid: currentUser.id) }
                }) {
                    HStack(spacing: 5) {
                        Text("🥕")
                            .font(.system(size: 14))
                        Text("\(entry.voteCount)")
                            .font(.system(size: 13))
                            .foregroundStyle(
                                entry.hasUpvoted(uid: currentUser.id) ? .white : .white.opacity(0.5)
                            )
                    }
                }
                .buttonStyle(.plain)
            }

            Button(action: { vm.toggleComments(activityId: entry.id) }) {
                HStack(spacing: 5) {
                    Image(systemName: "bubble.right")
                        .font(.system(size: 14))
                    if entry.commentCount > 0 {
                        Text("\(entry.commentCount)")
                            .font(.system(size: 13))
                    }
                }
                .foregroundStyle(vm.expandedComments.contains(entry.id) ? .white : .white.opacity(0.5))
            }
            .buttonStyle(.plain)

            Spacer()
        }
    }

    // MARK: - Comments section

    private var commentsSectionView: some View {
        VStack(alignment: .leading, spacing: 12) {
            let activityComments = vm.comments[entry.id] ?? []

            ForEach(activityComments) { comment in
                commentRow(comment)
            }

            ComposerView(
                user: currentUser,
                placeholder: "Add a comment…",
                isPosting: vm.postingComment.contains(entry.id),
                compact: true
            ) { text in
                Task { await vm.postComment(activityId: entry.id, text: text, currentUser: currentUser) }
            }
        }
    }

    private func commentRow(_ comment: ActivityComment) -> some View {
        HStack(alignment: .top, spacing: 8) {
            AvatarView(
                user: AppUser(id: comment.uid, firstname: comment.username, photoURL: comment.photoURL),
                size: 28
            )
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("@\(comment.username)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                    Spacer()
                    if comment.uid == currentUser.id {
                        Button(action: {
                            Task { await vm.deleteComment(activityId: entry.id, commentId: comment.id) }
                        }) {
                            Image(systemName: "trash")
                                .font(.system(size: 11))
                                .foregroundStyle(.white.opacity(0.3))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text(comment.text)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
    }
}

// MARK: - Sentiment badge colors

private extension Sentiment {
    var feedBadgeColor: Color {
        switch self {
        case .notGood: return Color(hex: "#ff6b6b")
        case .okay:    return Color(hex: "#ffd93d")
        case .good:    return Color(hex: "#6bcb77")
        case .amazing: return Color(hex: "#4d96ff")
        }
    }
}

// MARK: - Time formatting

extension Date {
    var feedTimeAgo: String {
        let diff = Date().timeIntervalSince(self)
        if diff < 60     { return "now" }
        if diff < 3600   { return "\(Int(diff / 60))m" }
        if diff < 86400  { return "\(Int(diff / 3600))h" }
        return "\(Int(diff / 86400))d"
    }
}
