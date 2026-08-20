import SwiftUI

struct DownloadableAssetStatusLabel: View {
    let text: String
    let systemImage: String
    let tint: Color
    var lineLimit: Int? = nil

    var body: some View {
        Label(text, systemImage: systemImage)
            .foregroundStyle(tint)
            .lineLimit(lineLimit)
    }
}

struct DownloadableAssetProgressView: View {
    let progress: Double
    let accessibilityLabel: String

    var body: some View {
        ProgressView(value: progress)
            .progressViewStyle(.linear)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(
                Text(progress, format: .percent.precision(.fractionLength(0)))
            )
    }
}

struct DownloadableAssetActionControl: View {
    enum State {
        case busy(accessibilityLabel: String)
        case button(title: String, role: ButtonRole? = nil, isEnabled: Bool = true)
    }

    let state: State
    let action: () -> Void

    var body: some View {
        switch state {
        case .busy(let accessibilityLabel):
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel(accessibilityLabel)
        case .button(let title, let role, let isEnabled):
            Button(title, role: role, action: action)
                .disabled(!isEnabled)
        }
    }
}
