import SwiftUI

/// Shared visual language for filtering controls.
///
/// Use `.overflow` when one menu combines multiple list controls such as
/// game, status, and sort. Use `.filter` for a focused filtering menu.
enum AppFilterMenuKind {
    case filter
    case overflow

    func systemImage(isActive: Bool) -> String {
        switch self {
        case .filter:
            return isActive
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
        case .overflow:
            return isActive ? "ellipsis.circle.fill" : "ellipsis.circle"
        }
    }
}

struct AppFilterMenuLabel: View {
    let kind: AppFilterMenuKind
    var title: String?
    var isActive = false
    var activeCount = 0

    var body: some View {
        Group {
            if let title {
                Label(title, systemImage: kind.systemImage(isActive: isActive))
            } else {
                Image(systemName: kind.systemImage(isActive: isActive))
            }
        }
        .overlay(alignment: .topTrailing) {
            if activeCount > 0 {
                Text("\(activeCount)")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .frame(minWidth: 16, minHeight: 16)
                    .background(Color.accentColor, in: Circle())
                    .offset(x: 8, y: -8)
            }
        }
    }
}
