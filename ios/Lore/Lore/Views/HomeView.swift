import SwiftUI

struct HomeView: View {
    @State private var vm = HomeViewModel()
    @Environment(AuthViewModel.self) private var authVM

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()

                if vm.isLoading {
                    ProgressView().tint(.white)
                } else if let error = vm.error {
                    errorView(message: error)
                } else if vm.feedItems.isEmpty {
                    emptyStateView
                } else {
                    feedListView
                }
            }
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            guard let user = authVM.currentUser, !user.followinglist.isEmpty else { return }
            if vm.feedItems.isEmpty {
                await vm.loadFeed(followingUids: user.followinglist)
            }
        }
    }

    // MARK: - Feed list

    private var feedListView: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(vm.feedItems) { entry in
                    if let user = authVM.currentUser {
                        ActivityCardView(entry: entry, vm: vm, currentUser: user)
                            .onAppear {
                                if entry.id == vm.feedItems.last?.id {
                                    Task { await vm.loadMore(followingUids: user.followinglist) }
                                }
                            }
                    }
                }

                if vm.isLoadingMore {
                    HStack { Spacer(); ProgressView().tint(.white); Spacer() }
                        .padding(.vertical, 16)
                }
            }
        }
        .refreshable {
            if let user = authVM.currentUser {
                await vm.loadFeed(followingUids: user.followinglist)
            }
        }
    }

    // MARK: - Error state

    private func errorView(message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(.white.opacity(0.3))
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.5))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Empty state

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.2")
                .font(.system(size: 40))
                .foregroundStyle(.white.opacity(0.2))

            Text("Nothing here yet")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)

            Text("Follow people to see their ratings here.")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.5))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 40)
    }
}
