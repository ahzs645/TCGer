import SwiftUI

struct CustomTabBar: View {
    @Binding var selectedTab: Int
    @Binding var isHidden: Bool
    let tabs: [TabItem]

    var body: some View {
        ZStack {
            // Full Tab Bar
            HStack(spacing: 0) {
                ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                    TabBarButton(
                        icon: tab.icon,
                        title: tab.title,
                        isSelected: selectedTab == index
                    ) {
                        selectedTab = index
                    }
                }
            }
            .frame(height: 49)
            .background(.ultraThinMaterial)
            .offset(y: isHidden ? 100 : 0)

            // Compact floating icon (when hidden)
            if isHidden {
                HStack {
                    Spacer()

                    Button {
                        withAnimation(.spring(response: 0.3)) {
                            isHidden = false
                        }
                    } label: {
                        Image(systemName: tabs[selectedTab].icon)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 50, height: 50)
                            .background(Color.accentColor)
                            .clipShape(Circle())
                            .shadow(color: Color.black.opacity(0.2), radius: 8, x: 0, y: 4)
                    }
                    .padding(.trailing, 16)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isHidden)
    }
}

struct TabBarButton: View {
    let icon: String
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                Text(title)
                    .font(.caption2)
            }
            .foregroundColor(isSelected ? .accentColor : .gray)
            .frame(maxWidth: .infinity)
        }
    }
}

struct TabItem {
    let icon: String
    let title: String
}

// Preference Key for tracking scroll offset
struct ScrollOffsetPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// View modifier to track scroll position
struct ScrollOffsetModifier: ViewModifier {
    @Binding var scrollOffset: CGFloat

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: ScrollOffsetPreferenceKey.self,
                        value: geometry.frame(in: .named("scroll")).minY
                    )
                }
            )
            .onPreferenceChange(ScrollOffsetPreferenceKey.self) { value in
                scrollOffset = value
            }
    }
}

extension View {
    func trackScrollOffset(_ scrollOffset: Binding<CGFloat>) -> some View {
        modifier(ScrollOffsetModifier(scrollOffset: scrollOffset))
    }
}
