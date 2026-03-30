import SwiftUI

struct RootView: View {
    @State private var authVM = AuthViewModel()
    @State private var minDelayElapsed = false

    var body: some View {
        Group {
            if authVM.isLoading || !minDelayElapsed {
                SplashView()
            } else if !authVM.isLoggedIn {
                LoginView(authVM: authVM)
            } else if authVM.needsOnboarding {
                OnboardingView(authVM: authVM)
            } else {
                MainTabView(authVM: authVM)
            }
        }
        .environment(authVM)
        .task {
            try? await Task.sleep(for: .seconds(1.5))
            minDelayElapsed = true
        }
    }
}

// MARK: - Splash

struct SplashView: View {
    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()
            VStack(spacing: 16) {
                Image("lore-logo 1")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 120, height: 120)
                Text("Lore")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
        }
    }
}

// MARK: - Color hex helper

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
