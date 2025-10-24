import SwiftUI

struct EmptyCollectionsView: View {
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: "folder.badge.plus")
                    .font(.system(size: 50))
                    .foregroundColor(.blue)
            }

            VStack(spacing: 12) {
                Text("No Collections Yet")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("Create your first collection to start organizing your cards")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            // Tips
            VStack(alignment: .leading, spacing: 16) {
                TipRow(
                    icon: "square.stack.3d.up.fill",
                    title: "Organize by Theme",
                    description: "Create binders for different decks or sets"
                )

                TipRow(
                    icon: "tag.fill",
                    title: "Track Value",
                    description: "Monitor the market value of your collection"
                )

                TipRow(
                    icon: "chart.line.uptrend.xyaxis",
                    title: "See Analytics",
                    description: "View insights and trends for your cards"
                )
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
            .padding(.horizontal)

            // CTA Button
            Button(action: onCreate) {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Create Your First Collection")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .cornerRadius(12)
            }
            .padding(.horizontal)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

struct TipRow: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(.blue)
                .frame(width: 30)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
    }
}

#Preview {
    EmptyCollectionsView(onCreate: {})
}
