import SwiftUI
import UIKit

/// Uses the same confirmation for Cancel and an attempted sheet swipe.
struct UnsavedChangesGuard: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    let hasChanges: Bool
    var isSaving = false
    @Binding var confirmingDiscard: Bool

    func body(content: Content) -> some View {
        content
            .background {
                SheetDismissalObserver(isBlocked: hasChanges || isSaving) {
                    if hasChanges && !isSaving { confirmingDiscard = true }
                }
            }
            .confirmationDialog("Discard changes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard Changes", role: .destructive) { dismiss() }
                // A regular action stays visible in iOS 26 popover presentations,
                // which otherwise omit the cancel-role button.
                Button("Keep Editing") {}
            } message: {
                Text("Your unsaved changes will be lost.")
            }
    }
}

private struct SheetDismissalObserver: UIViewControllerRepresentable {
    var isBlocked: Bool
    var onAttempt: () -> Void

    func makeUIViewController(context: Context) -> ObserverController {
        ObserverController()
    }

    func updateUIViewController(_ controller: ObserverController, context: Context) {
        controller.isBlocked = isBlocked
        controller.onAttempt = onAttempt
        controller.installDelegate()
    }

    final class ObserverController: UIViewController, UIAdaptivePresentationControllerDelegate {
        private weak var originalDelegate: (any UIAdaptivePresentationControllerDelegate)?
        var isBlocked = false
        var onAttempt: () -> Void = {}

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            installDelegate()
        }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            installDelegate()
        }

        func installDelegate() {
            var ancestor: UIViewController? = parent
            while let controller = ancestor {
                if let presentation = controller.presentationController {
                    if presentation.delegate !== self {
                        originalDelegate = presentation.delegate
                        presentation.delegate = self
                    }
                    return
                }
                ancestor = controller.parent
            }
        }

        func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
            !isBlocked && (originalDelegate?.presentationControllerShouldDismiss?(presentationController) ?? true)
        }

        func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
            originalDelegate?.presentationControllerWillDismiss?(presentationController)
        }

        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            // Preserve SwiftUI's sheet binding and onDismiss bookkeeping.
            originalDelegate?.presentationControllerDidDismiss?(presentationController)
        }

        func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
            onAttempt()
        }
    }
}
