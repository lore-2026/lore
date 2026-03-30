import SwiftUI

struct MediaCardView: View {
    let item: MediaItem
    var score: Double? = nil
    var showAddButton = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topTrailing) {
                // Poster
                Group {
                    if let url = URL(string: item.posterUrl(size: "w185")) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color(hex: "#2b2a33")
                        }
                    } else {
                        Color(hex: "#2b2a33")
                    }
                }
                .frame(width: 120, height: 170)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                // Score badge
                if let score {
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color(hex: "#141218"))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .padding(6)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(2)

                Text(item.releaseYear ?? " ")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
            }
            .frame(width: 120)
            .frame(minHeight: 48, alignment: .topLeading)
        }
    }
}
