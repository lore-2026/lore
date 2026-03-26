import SwiftUI

struct MainTabView: View {
    @Bindable var authVM: AuthViewModel
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            ExploreView()
                .tabItem {
                    Label("Explore", systemImage: "magnifyingglass")
                }
                .tag(0)

            if let user = authVM.currentUser {
                ProfileView(uid: user.id, isCurrentUser: true)
                    .tabItem {
                        Label("Profile", systemImage: "person.fill")
                    }
                    .tag(1)
            }

            SettingsView(authVM: authVM)
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(2)
        }
        .tint(.white)
        .preferredColorScheme(.dark)
    }
}
