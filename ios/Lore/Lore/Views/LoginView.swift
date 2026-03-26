import SwiftUI

struct LoginView: View {
    @Bindable var authVM: AuthViewModel

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo + title
                VStack(spacing: 12) {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 72))
                        .foregroundStyle(.white)

                    Text("Lore")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Rate movies and shows.\nShare with friends.")
                        .font(.system(size: 16))
                        .foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                }

                Spacer()

                // Sign in button
                VStack(spacing: 12) {
                    if let error = authVM.error {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundStyle(Color(hex: "#FF6B6B"))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    Button(action: {
                        Task { await authVM.signInWithGoogle() }
                    }) {
                        HStack(spacing: 12) {
                            if authVM.isLoading {
                                ProgressView()
                                    .tint(Color(hex: "#141218"))
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "g.circle.fill")
                                    .font(.system(size: 20))
                                    .foregroundStyle(Color(hex: "#141218"))
                            }
                            Text(authVM.isLoading ? "Signing in…" : "Continue with Google")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Color(hex: "#141218"))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                    }
                    .disabled(authVM.isLoading)
                    .padding(.horizontal, 32)
                }
                .padding(.bottom, 56)
            }
        }
    }
}
