import SwiftUI

private struct KeyboardDismissToolbar: ViewModifier {
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }
                .accessibilityIdentifier(ParityControlID.actionKeyboardDismiss)
            }
        }
    }
}

extension View {
    func keyboardDismissToolbar() -> some View { modifier(KeyboardDismissToolbar()) }
}
