import SwiftUI

struct ColorPickerGrid: View {
    @Binding var selectedColor: Color
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion

    private let columns = [
        GridItem(.adaptive(minimum: 44, maximum: 44), spacing: 12)
    ]

    static let accessibilityColorNames = [
        "Light blue", "Blue", "Dark blue",
        "Light green", "Green", "Dark green",
        "Light orange", "Orange", "Yellow",
        "Red", "Pink", "Dark pink",
        "Light purple", "Purple", "Dark purple",
        "Light teal", "Teal", "Gray",
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(Color.binderColors.indices, id: \.self) { index in
                let isSelected = selectedColor.toHex() == Color.binderColors[index].toHex()
                Button {
                    withAnimation(accessibilityReduceMotion ? nil : .spring(response: 0.3)) {
                        selectedColor = Color.binderColors[index]
                    }
                } label: {
                    ColorCircle(
                        color: Color.binderColors[index],
                        isSelected: isSelected
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Self.accessibilityColorNames[index])
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Color")
    }
}

struct ColorCircle: View {
    let color: Color
    let isSelected: Bool
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion

    var body: some View {
        ZStack {
            Circle()
                .fill(color)
                .frame(width: 44, height: 44)
                .shadow(color: color.opacity(0.4), radius: isSelected ? 8 : 4, x: 0, y: 2)
                .scaleEffect(isSelected ? 1.1 : 1.0)

            Circle()
                .stroke(Color.white, lineWidth: isSelected ? 3 : 0)
                .frame(width: 44, height: 44)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(colorBrightness(color) > 0.6 ? .black : .white)
            }
        }
        .animation(accessibilityReduceMotion ? nil : .spring(response: 0.3), value: isSelected)
    }

    private func colorBrightness(_ color: Color) -> Double {
        let uiColor = UIColor(color)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0

        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        // Calculate perceived brightness
        return Double((red * 299 + green * 587 + blue * 114) / 1000)
    }
}

#Preview {
    struct PreviewWrapper: View {
        @State private var selectedColor: Color = Color.binderColors[0]

        var body: some View {
            VStack {
                Text("Color")
                    .font(.headline)
                ColorPickerGrid(selectedColor: $selectedColor)

                Text("Selected: \(selectedColor.toHex())")
                    .padding()
            }
            .padding()
        }
    }

    return PreviewWrapper()
}
