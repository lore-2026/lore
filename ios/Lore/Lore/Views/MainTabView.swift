import SwiftUI

struct MainTabView: View {
    @Bindable var authVM: AuthViewModel
    @State private var selectedTab = 0

    init(authVM: AuthViewModel) {
        self.authVM = authVM
        let appearance = UITabBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundColor = UIColor(red: 0x14/255, green: 0x12/255, blue: 0x18/255, alpha: 1)
        appearance.shadowColor = .clear
        appearance.stackedLayoutAppearance.normal.iconColor = .white
        appearance.stackedLayoutAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor.white]
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem {
                    Label("Home", image: "house")
                }
                .tag(0)

            ExploreView()
                .tabItem {
                    Label("Explore", image: "search")
                }
                .tag(1)

            if let user = authVM.currentUser {
                ProfileView(uid: user.id, isCurrentUser: true)
                    .tabItem {
                        Label("Profile", image: "user")
                    }
                    .tag(2)
            }

            SettingsView(authVM: authVM)
                .tabItem {
                    Label("Settings", image: "settings")
                }
                .tag(3)
        }
        .tint(.white)
        .preferredColorScheme(.dark)
    }
}
