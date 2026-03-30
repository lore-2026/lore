import SwiftUI

struct DiscussionSectionView: View {
    let mediaKey: String
    let mediaTitle: String
    let userScore: Double?

    @State private var threads: [DiscussionThread] = []
    @State private var isLoading = false
    @State private var tab = 0   // 0 = Friends, 1 = All
    @State private var composerText = ""
    @State private var isPosting = false

    @Environment(AuthViewModel.self) private var authVM
    private let db = FirestoreService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Section header + tab pills
            HStack {
                Text("Discussion")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                Spacer()

                HStack(spacing: 8) {
                    ForEach(["Friends", "All"], id: \.self) { label in
                        let idx = label == "Friends" ? 0 : 1
                        Button(action: { tab = idx }) {
                            Text(label)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(tab == idx ? .white : .white.opacity(0.5))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .background(
                                    tab == idx
                                        ? Color.white.opacity(0.12)
                                        : Color.clear
                                )
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule()
                                        .stroke(Color(hex: "#2a2930"), lineWidth: 1)
                                )
                        }
                    }
                }
            }
            .padding(.horizontal, 16)

            // Composer
            if let user = authVM.currentUser {
                ComposerView(
                    user: user,
                    placeholder: "Share your thoughts on \(mediaTitle)…",
                    isPosting: isPosting
                ) { text in
                    Task { await postThread(text: text, user: user) }
                }
                .padding(.horizontal, 16)
            }

            // Thread list
            if isLoading {
                HStack { Spacer(); ProgressView().tint(.white); Spacer() }
            } else if threads.isEmpty {
                Text("No discussion yet. Be the first to share your thoughts!")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.4))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 24)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach($threads) { $thread in
                        ThreadView(
                            thread: $thread,
                            mediaKey: mediaKey,
                            currentUser: authVM.currentUser
                        )
                        Divider().background(Color(hex: "#2a2930"))
                    }
                }
            }
        }
        .task { await loadThreads() }
        .onChange(of: tab) { _, _ in Task { await loadThreads() } }
    }

    private func loadThreads() async {
        isLoading = true
        defer { isLoading = false }
        guard let user = authVM.currentUser else { return }

        do {
            var results: [(id: String, data: [String: Any])]

            if tab == 0 {
                // Friends tab: current user + following
                let uids = [user.id] + user.followinglist
                let chunks = uids.chunked(into: 30)
                results = []
                for chunk in chunks {
                    let r = try await db.queryCollection(
                        path: "mediaDiscussions/\(mediaKey)/threads",
                        filters: [.init(field: "uid", op: "IN", value: chunk)],
                        orderBy: "createdAt",
                        descending: true,
                        limit: 20
                    )
                    results.append(contentsOf: r)
                }
            } else {
                results = try await db.queryCollection(
                    path: "mediaDiscussions/\(mediaKey)/threads",
                    orderBy: "voteCount",
                    descending: true,
                    limit: 20
                )
            }

            threads = results.compactMap { DiscussionThread.from(id: $0.id, data: $0.data) }
        } catch {
            threads = []
        }
    }

    private func postThread(text: String, user: AppUser) async {
        isPosting = true
        defer { isPosting = false }

        var stub = DiscussionThread(
            id: UUID().uuidString,
            uid: user.id,
            username: user.username,
            photoURL: user.photoURL,
            text: text,
            voteCount: 0,
            upvoterUids: [],
            replyCount: 0,
            createdAt: Date(),
            userScore: userScore
        )

        do {
            let data = stub.toFirestoreData(currentUser: user, userScore: userScore)
            let newId = try await db.addDocument(
                collectionPath: "mediaDiscussions/\(mediaKey)/threads",
                data: data
            )
            stub = DiscussionThread(
                id: newId,
                uid: stub.uid,
                username: stub.username,
                photoURL: stub.photoURL,
                text: stub.text,
                voteCount: 0,
                upvoterUids: [],
                replyCount: 0,
                createdAt: stub.createdAt,
                userScore: stub.userScore
            )
            threads.insert(stub, at: 0)
        } catch {}
    }
}

// MARK: - Single thread

private struct ThreadView: View {
    @Binding var thread: DiscussionThread
    let mediaKey: String
    let currentUser: AppUser?
    @State private var showReplies = false

    private let db = FirestoreService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Author row
            HStack(alignment: .top, spacing: 10) {
                if let user = currentUser {
                    AvatarView(user: AppUser(id: thread.uid, firstname: thread.username), size: 36)
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("@\(thread.username)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                        if let score = thread.userScore {
                            Text(String(format: "%.1f", score))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Color(hex: "#141218"))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        Spacer()
                        Text(thread.createdAt.timeAgo)
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.4))
                    }

                    Text(thread.text)
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.9))
                }
            }

            // Action row
            HStack(spacing: 20) {
                // Upvote
                Button(action: { Task { await toggleUpvote() } }) {
                    HStack(spacing: 4) {
                        Text("🥕")
                            .font(.system(size: 14))
                        Text("\(thread.voteCount)")
                            .font(.system(size: 13))
                            .foregroundStyle(
                                thread.hasUpvoted(uid: currentUser?.id ?? "") ? .white : .white.opacity(0.5)
                            )
                    }
                }

                // Reply
                Button(action: { showReplies.toggle() }) {
                    HStack(spacing: 4) {
                        Image(systemName: "bubble.right")
                            .font(.system(size: 13))
                        Text("\(thread.replyCount)")
                            .font(.system(size: 13))
                    }
                    .foregroundStyle(.white.opacity(0.5))
                }

                Spacer()

                // Delete (owner only)
                if thread.uid == currentUser?.id {
                    Button(action: { Task { await deleteThread() } }) {
                        Image(systemName: "trash")
                            .font(.system(size: 13))
                            .foregroundStyle(.white.opacity(0.3))
                    }
                }
            }
            .padding(.leading, 46)

            // Replies
            if showReplies {
                ReplyListView(
                    thread: $thread,
                    mediaKey: mediaKey,
                    currentUser: currentUser
                )
                .padding(.leading, 46)
            }
        }
        .padding(16)
    }

    private func toggleUpvote() async {
        guard let uid = currentUser?.id else { return }
        let wasUpvoted = thread.hasUpvoted(uid: uid)
        // Optimistic
        if wasUpvoted {
            thread.upvoterUids.removeAll { $0 == uid }
            thread.voteCount -= 1
        } else {
            thread.upvoterUids.append(uid)
            thread.voteCount += 1
        }
        let delta = wasUpvoted ? -1 : 1
        let threadPath = "mediaDiscussions/\(mediaKey)/threads/\(thread.id)"

        var writes: [FirestoreService.WriteOp] = [
            .init(kind: .increment(path: threadPath, field: "voteCount", amount: delta)),
            wasUpvoted
                ? .init(kind: .arrayRemove(path: threadPath, field: "upvoterUids", values: [uid]))
                : .init(kind: .arrayUnion(path: threadPath,  field: "upvoterUids", values: [uid]))
        ]
        // If this thread was created from a feed activity post, keep vote counts in sync
        if let activityId = thread.activityId {
            writes += [
                .init(kind: .increment(path: "activity/\(activityId)", field: "voteCount", amount: delta)),
                wasUpvoted
                    ? .init(kind: .arrayRemove(path: "activity/\(activityId)", field: "upvoterUids", values: [uid]))
                    : .init(kind: .arrayUnion( path: "activity/\(activityId)", field: "upvoterUids", values: [uid]))
            ]
        }
        try? await db.commit(writes: writes)
    }

    private func deleteThread() async {
        try? await db.deleteDocument(path: "mediaDiscussions/\(mediaKey)/threads/\(thread.id)")
    }
}

// MARK: - Reply list

private struct ReplyListView: View {
    @Binding var thread: DiscussionThread
    let mediaKey: String
    let currentUser: AppUser?
    @State private var isLoading = false

    private let db = FirestoreService.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(thread.replies) { reply in
                ReplyView(
                    reply: reply,
                    threadId: thread.id,
                    mediaKey: mediaKey,
                    currentUser: currentUser
                )
            }

            if let user = currentUser {
                ComposerView(
                    user: user,
                    placeholder: "Reply…",
                    isPosting: isLoading,
                    compact: true
                ) { text in
                    Task { await postReply(text: text, user: user) }
                }
            }
        }
        .task { await loadReplies() }
    }

    private func loadReplies() async {
        isLoading = true
        defer { isLoading = false }
        let results = (try? await db.queryCollection(
            path: "mediaDiscussions/\(mediaKey)/threads/\(thread.id)/replies",
            orderBy: "createdAt",
            limit: 20
        )) ?? []
        thread.replies = results.compactMap { ThreadReply.from(id: $0.id, data: $0.data) }
    }

    private func postReply(text: String, user: AppUser) async {
        isLoading = true
        defer { isLoading = false }
        var stub = ThreadReply(
            id: UUID().uuidString,
            uid: user.id,
            username: user.username,
            photoURL: user.photoURL,
            text: text,
            voteCount: 0,
            upvoterUids: [],
            createdAt: Date()
        )
        do {
            let data = stub.toFirestoreData(currentUser: user, userScore: nil)
            let newId = try await db.addDocument(
                collectionPath: "mediaDiscussions/\(mediaKey)/threads/\(thread.id)/replies",
                data: data
            )
            stub = ThreadReply(id: newId, uid: stub.uid, username: stub.username, photoURL: stub.photoURL, text: stub.text, voteCount: 0, upvoterUids: [], createdAt: stub.createdAt)
            thread.replies.append(stub)
            thread.replyCount += 1
            try? await db.commit(writes: [
                .init(kind: .increment(path: "mediaDiscussions/\(mediaKey)/threads/\(thread.id)", field: "replyCount", amount: 1))
            ])
        } catch {}
    }
}

private struct ReplyView: View {
    let reply: ThreadReply
    let threadId: String
    let mediaKey: String
    let currentUser: AppUser?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let user = currentUser {
                AvatarView(user: AppUser(id: reply.uid, firstname: reply.username), size: 28)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("@\(reply.username)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                Text(reply.text)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
    }
}

// MARK: - Composer

struct ComposerView: View {
    let user: AppUser
    let placeholder: String
    let isPosting: Bool
    var compact: Bool = false
    let onPost: (String) -> Void

    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextField(placeholder, text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
                .font(.system(size: compact ? 13 : 14))
                .lineLimit(compact ? 3 : 6, reservesSpace: false)
                .focused($focused)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color(hex: "#1c1b21"))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#2a2930"), lineWidth: 1))

            if focused || !text.isEmpty {
                HStack {
                    Button("Cancel") {
                        text = ""
                        focused = false
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))

                    Spacer()

                    Button(action: {
                        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        onPost(trimmed)
                        text = ""
                        focused = false
                    }) {
                        if isPosting {
                            ProgressView().scaleEffect(0.7).tint(.white)
                        } else {
                            Text("Post")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .white.opacity(0.3) : Color(hex: "#141218"))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.white.opacity(0.2) : Color.white)
                                .clipShape(Capsule())
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isPosting)
                }
            }
        }
    }
}

// MARK: - Helpers

private extension Date {
    var timeAgo: String {
        let diff = Date().timeIntervalSince(self)
        if diff < 60 { return "now" }
        if diff < 3600 { return "\(Int(diff/60))m" }
        if diff < 86400 { return "\(Int(diff/3600))h" }
        return "\(Int(diff/86400))d"
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
