import SwiftUI

// MARK: - Rating flow container

struct RatingFlowView: View {
    @Bindable var vm: DetailsViewModel
    @Environment(AuthViewModel.self) private var authVM
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            switch vm.phase {
            case .initial:
                SentimentPickerPage(vm: vm, onCancel: { dismiss() })
                    .transition(.asymmetric(
                        insertion: .opacity,
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            case .comparing:
                SwipeComparisonPage(vm: vm)
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            case .done:
                RatingCompletePage(vm: vm, onDone: { dismiss() })
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .opacity
                    ))
            }
        }
        .animation(.easeInOut(duration: 0.32), value: vm.phase)
    }
}

// MARK: - Step 1: Sentiment + note

private struct SentimentPickerPage: View {
    @Bindable var vm: DetailsViewModel
    @Environment(AuthViewModel.self) private var authVM
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Top bar
            HStack {
                Button("Cancel", action: onCancel)
                    .font(.system(size: 16))
                    .foregroundStyle(.white.opacity(0.5))
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 28)

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    // Header
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Add a rating")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(.white)
                        if let title = vm.mediaItem?.title {
                            Text(title)
                                .font(.system(size: 15))
                                .foregroundStyle(.white.opacity(0.45))
                        }
                    }
                    .padding(.horizontal, 24)

                    // Sentiment tiles
                    VStack(alignment: .leading, spacing: 12) {
                        Text("HOW WAS IT?")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.4))
                            .tracking(1.2)
                            .padding(.horizontal, 24)

                        HStack(spacing: 10) {
                            ForEach(Sentiment.allCases, id: \.self) { s in
                                SentimentTile(
                                    sentiment: s,
                                    isSelected: vm.selectedSentiment == s,
                                    action: { vm.selectedSentiment = s }
                                )
                            }
                        }
                        .padding(.horizontal, 24)
                    }

                    // Season picker (TV only)
                    if let media = vm.mediaItem, media.mediaType == .tv,
                       let seasons = media.seasons, !seasons.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("SEASON")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.4))
                                .tracking(1.2)
                                .padding(.horizontal, 24)

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
                                    Image(systemName: "chevron.up.chevron.down")
                                        .font(.system(size: 12))
                                        .foregroundStyle(.white.opacity(0.4))
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 14)
                                .background(Color(hex: "#1c1b21"))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#2a2930")))
                                .padding(.horizontal, 24)
                            }
                        }
                    }

                    // Note field
                    VStack(alignment: .leading, spacing: 12) {
                        Text("REVIEW (OPTIONAL)")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.4))
                            .tracking(1.2)
                            .padding(.horizontal, 24)

                        TextField("What did you think?", text: $vm.note, axis: .vertical)
                            .textFieldStyle(.plain)
                            .foregroundStyle(.white)
                            .tint(.white)
                            .lineLimit(4, reservesSpace: true)
                            .padding(14)
                            .background(Color(hex: "#1c1b21"))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#2a2930")))
                            .padding(.horizontal, 24)
                    }
                }
                .padding(.bottom, 120)
            }

            // Pinned bottom CTA
            VStack(spacing: 0) {
                Color(hex: "#2a2930").frame(height: 0.5)
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
                    let canProceed = vm.selectedSentiment != nil
                    Text("Next")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(canProceed ? Color(hex: "#141218") : Color(hex: "#141218").opacity(0.35))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(canProceed ? Color.white : Color.white.opacity(0.3))
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                }
                .disabled(vm.selectedSentiment == nil)
                .padding(.horizontal, 24)
                .padding(.top, 14)
                .padding(.bottom, 34)
            }
            .background(Color(hex: "#141218"))
        }
    }
}

private struct SentimentTile: View {
    let sentiment: Sentiment
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Text(sentiment.emoji)
                    .font(.system(size: 26))
                Text(sentiment.displayName)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(isSelected ? Color(hex: "#141218") : .white.opacity(0.8))
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(isSelected ? Color.white : Color(hex: "#1c1b21"))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.clear : Color(hex: "#2a2930"), lineWidth: 1)
            )
        }
        .animation(.easeInOut(duration: 0.15), value: isSelected)
    }
}

// MARK: - Step 2: Swipe comparison

private struct SwipeComparisonPage: View {
    @Bindable var vm: DetailsViewModel
    @Environment(AuthViewModel.self) private var authVM
    @Environment(\.dismiss) private var dismiss

    @State private var dragOffset: CGFloat = 0
    @State private var dragRotation: Double = 0
    @State private var isCommitting = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                if let comp = vm.comparison,
                   let entry = comp.currentComparison,
                   let newTitle = vm.mediaItem?.title {
                    let existingTitle = vm.comparisonMediaCache[entry.mediaId]?.title ?? entry.mediaName ?? "this"
                    Text("How does \"\(newTitle)\" compare to \"\(existingTitle)\"?")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                } else {
                    Text("How does this compare?")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .padding(.top, 60)

            Spacer()

            if let comp = vm.comparison, let entry = comp.currentComparison {
                // Affordance labels — opacity tracks drag distance
                HStack {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 13, weight: .bold))
                        Text("Worse")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(Color(red: 1, green: 0.38, blue: 0.38))
                    .opacity(dragOffset < -15 ? min(1, abs(dragOffset) / 70) : 0.22)

                    Spacer()

                    HStack(spacing: 5) {
                        Text("Better")
                            .font(.system(size: 14, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Color(red: 0.35, green: 0.9, blue: 0.55))
                    .opacity(dragOffset > 15 ? min(1, dragOffset / 70) : 0.22)
                }
                .padding(.horizontal, 48)
                .padding(.bottom, 18)
                .animation(.easeOut(duration: 0.08), value: dragOffset)

                ComparisonSwipeCard(entry: entry, vm: vm, dragOffset: dragOffset)
                    .offset(x: dragOffset)
                    .rotationEffect(.degrees(dragRotation), anchor: .bottom)
                    .gesture(
                        DragGesture(minimumDistance: 8)
                            .onChanged { value in
                                guard !isCommitting else { return }
                                withAnimation(.interactiveSpring()) {
                                    dragOffset = value.translation.width
                                    dragRotation = Double(value.translation.width) / 20.0
                                }
                            }
                            .onEnded { value in
                                guard !isCommitting else { return }
                                handleSwipe(translation: value.translation.width)
                            }
                    )
            }

            Spacer()

            VStack(spacing: 16) {
                Button(action: {
                    guard !isCommitting, let uid = authVM.currentUser?.id else { return }
                    let generator = UIImpactFeedbackGenerator(style: .light)
                    generator.impactOccurred()
                    vm.skipComparison(uid: uid)
                    resetCard()
                }) {
                    Text("Too tough to call")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.4))
                        .padding(.vertical, 14)
                        .padding(.horizontal, 28)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Color(hex: "#2a2930"), lineWidth: 1))
                }

                Button(action: { dismiss() }) {
                    Text("Cancel")
                        .font(.system(size: 15))
                        .foregroundStyle(.white.opacity(0.3))
                }
            }
            .padding(.bottom, 52)
        }
    }

    private func handleSwipe(translation: CGFloat) {
        guard abs(translation) >= 80 else {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                dragOffset = 0
                dragRotation = 0
            }
            return
        }

        let preferNewItem = translation > 0  // swipe right = "Better" = new item wins
        isCommitting = true

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        withAnimation(.easeOut(duration: 0.22)) {
            dragOffset = translation > 0 ? 520 : -520
            dragRotation = translation > 0 ? 14 : -14
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) {
            if let uid = authVM.currentUser?.id {
                vm.compareChoice(preferNewItem: preferNewItem, uid: uid)
            }
            resetCard()
            isCommitting = false
        }
    }

    private func resetCard() {
        dragOffset = 0
        dragRotation = 0
    }
}

private struct ComparisonSwipeCard: View {
    let entry: RatingEntry
    @Bindable var vm: DetailsViewModel
    let dragOffset: CGFloat

    private var cachedMedia: MediaItem? { vm.comparisonMediaCache[entry.mediaId] }

    private var posterURL: URL? {
        guard let path = cachedMedia?.posterPath else { return nil }
        return URL(string: "\(Config.tmdbImageBase)/w500\(path)")
    }

    private var borderColor: Color {
        if dragOffset > 30 {
            let opacity = min(1.0, Double(dragOffset) / 110.0)
            return Color(red: 0.35, green: 0.9, blue: 0.55).opacity(opacity)
        } else if dragOffset < -30 {
            let opacity = min(1.0, Double(abs(dragOffset)) / 110.0)
            return Color(red: 1.0, green: 0.38, blue: 0.38).opacity(opacity)
        }
        return .clear
    }

    var body: some View {
        VStack(spacing: 20) {
            // Poster
            ZStack {
                Color(hex: "#1c1b21")
                if let url = posterURL {
                    AsyncImage(url: url) { phase in
                        if case .success(let img) = phase {
                            img.resizable().scaledToFill()
                        } else {
                            posterPlaceholder
                        }
                    }
                } else {
                    posterPlaceholder
                }
            }
            .frame(width: 200, height: 298)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(borderColor, lineWidth: 3))
            .shadow(color: .black.opacity(0.5), radius: 28, x: 0, y: 14)

            // Title + year
            VStack(spacing: 5) {
                Text(entry.mediaName ?? "Unknown")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                if let year = cachedMedia?.releaseYear {
                    Text(year)
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(.horizontal, 32)
        }
    }

    private var posterPlaceholder: some View {
        Image(systemName: "film")
            .font(.system(size: 48))
            .foregroundStyle(.white.opacity(0.12))
    }
}

// MARK: - Step 3: Ranked!

private struct RatingCompletePage: View {
    @Bindable var vm: DetailsViewModel
    let onDone: () -> Void

    @State private var showContent = false
    @State private var confettiParticles: [ConfettiParticle] = []

    private var posterURL: URL? {
        guard let path = vm.mediaItem?.posterPath else { return nil }
        return URL(string: "\(Config.tmdbImageBase)/w342\(path)")
    }

    var body: some View {
        ZStack {
            ConfettiView(particles: confettiParticles)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack(spacing: 0) {
                Spacer()

                // Poster
                Group {
                    if let url = posterURL {
                        AsyncImage(url: url) { phase in
                            if case .success(let img) = phase {
                                img.resizable().scaledToFill()
                            } else {
                                Color(hex: "#1c1b21")
                            }
                        }
                    } else {
                        Color(hex: "#1c1b21")
                    }
                }
                .frame(width: 220, height: 327)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .shadow(color: .black.opacity(0.5), radius: 32, x: 0, y: 16)
                .scaleEffect(showContent ? 1 : 0.88)
                .opacity(showContent ? 1 : 0)

                // "Your rating of [Title]" + score
                VStack(spacing: 12) {
                    if let title = vm.mediaItem?.title {
                        Text("Your rating of \(title)")
                            .font(.system(size: 20))
                            .foregroundStyle(.white.opacity(0.45))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }

                    if let score = vm.myRating?.displayScore {
                        Text(String(format: "%.1f", score))
                            .font(.system(size: 56, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(.top, 28)
                .opacity(showContent ? 1 : 0)
                .offset(y: showContent ? 0 : 12)

                Spacer()

                Button(action: onDone) {
                    Text("Done")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color(hex: "#141218"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 32))
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 50)
                .opacity(showContent ? 1 : 0)
            }
        }
        .onAppear {
            confettiParticles = ConfettiParticle.burst()
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
            withAnimation(.spring(response: 0.5, dampingFraction: 0.62)) {
                showContent = true
            }
        }
    }
}

// MARK: - Confetti

private struct ConfettiParticle: Identifiable {
    let id = UUID()
    let startX: CGFloat
    let startY: CGFloat
    let color: Color
    let size: CGFloat
    let vx: CGFloat
    let vy: CGFloat
    let angularVelocity: CGFloat
    let initialRotation: CGFloat

    static func burst(count: Int = 90) -> [ConfettiParticle] {
        let bounds = UIScreen.main.bounds
        let cx = bounds.width / 2
        let cy = bounds.height * 0.38

        let colors: [Color] = [
            .white,
            Color(red: 1.0, green: 0.85, blue: 0.2),
            Color(red: 0.4, green: 0.85, blue: 1.0),
            Color(red: 1.0, green: 0.42, blue: 0.62),
            Color(red: 0.55, green: 1.0, blue: 0.48),
            Color(red: 0.85, green: 0.52, blue: 1.0),
            Color(red: 1.0, green: 0.65, blue: 0.2),
        ]

        return (0..<count).map { _ in
            let angle = CGFloat.random(in: 0 ..< (.pi * 2))
            let speed = CGFloat.random(in: 120 ... 420)
            return ConfettiParticle(
                startX: cx + CGFloat.random(in: -18 ... 18),
                startY: cy,
                color: colors.randomElement()!,
                size: CGFloat.random(in: 7 ... 14),
                vx: cos(angle) * speed,
                vy: sin(angle) * speed - CGFloat.random(in: 80 ... 240),
                angularVelocity: CGFloat.random(in: -500 ... 500),
                initialRotation: CGFloat.random(in: 0 ... 360)
            )
        }
    }
}

private struct ConfettiView: View {
    let particles: [ConfettiParticle]
    @State private var startDate = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            Canvas { ctx, _ in
                let elapsed = CGFloat(timeline.date.timeIntervalSince(startDate))
                let gravity: CGFloat = 680

                for p in particles {
                    let px = p.startX + p.vx * elapsed
                    let py = p.startY + p.vy * elapsed + 0.5 * gravity * elapsed * elapsed
                    let rotDeg = p.initialRotation + p.angularVelocity * elapsed
                    let rotRad = rotDeg * .pi / 180.0

                    // Full for 0.7 s, then fade to zero over 0.8 s
                    let opacity = elapsed < 0.7
                        ? 1.0
                        : max(0.0, 1.0 - Double(elapsed - 0.7) / 0.8)
                    guard opacity > 0 else { continue }

                    ctx.opacity = opacity

                    let pw = p.size
                    let ph = p.size * 0.42
                    let rect = CGRect(x: -pw / 2, y: -ph / 2, width: pw, height: ph)
                    let transform = CGAffineTransform(translationX: px, y: py)
                        .rotated(by: rotRad)
                    var path = Path(roundedRect: rect, cornerRadius: 2)
                    path = path.applying(transform)
                    ctx.fill(path, with: .color(p.color))
                }
            }
        }
    }
}
