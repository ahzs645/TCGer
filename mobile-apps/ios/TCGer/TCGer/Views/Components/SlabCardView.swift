import SwiftUI

struct SlabCardView: View {
    let cardImageURL: String?
    let gradingCompany: String
    let gradingScore: String
    let certNumber: String?
    let cardName: String
    let setName: String?

    private var companyColor: Color {
        switch gradingCompany.uppercased() {
        case "PSA": return .red
        case "BGS", "BECKETT": return Color(.systemYellow)
        case "CGC": return .green
        case "SGC": return .blue
        default: return .gray
        }
    }

    private var companyGradient: LinearGradient {
        LinearGradient(
            colors: [companyColor.opacity(0.8), companyColor],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            // Slab Header
            VStack(spacing: 4) {
                Text(gradingCompany.uppercased())
                    .font(.caption)
                    .fontWeight(.heavy)
                    .tracking(2)
                    .foregroundColor(.white)

                Text(gradingScore)
                    .font(.system(size: 32, weight: .black, design: .rounded))
                    .foregroundColor(.white)

                if let cert = certNumber, !cert.isEmpty {
                    Text("Cert #\(cert)")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.8))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(companyGradient)

            // Card Image
            ZStack {
                Rectangle()
                    .fill(Color(.systemGray6))

                if let url = cardImageURL, let imageURL = URL(string: url) {
                    CachedAsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .padding(12)
                        case .failure, .empty:
                            Image(systemName: "photo")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                        @unknown default:
                            ProgressView()
                        }
                    }
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)
                }
            }
            .aspectRatio(0.68, contentMode: .fit)

            // Slab Footer
            VStack(spacing: 2) {
                Text(cardName)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .foregroundColor(.primary)

                if let setName, !setName.isEmpty {
                    Text(setName)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color(.systemGray5))
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(companyColor.opacity(0.4), lineWidth: 2)
        )
        .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
    }
}

// MARK: - Grading Badge (for CollectionCardRow)

struct GradingBadge: View {
    let company: String
    let score: String

    private var badgeColor: Color {
        switch company.uppercased() {
        case "PSA": return .red
        case "BGS", "BECKETT": return Color(.systemYellow)
        case "CGC": return .green
        case "SGC": return .blue
        default: return .gray
        }
    }

    var body: some View {
        Text("\(company) \(score)")
            .font(.caption2)
            .fontWeight(.bold)
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(badgeColor)
            .cornerRadius(4)
    }
}
