import SwiftUI
import UIKit

struct BinderPageRecoveryReviewContext: Identifiable {
    let conflict: BinderPageRecoveryConflict
    let attempt: DeferredBinderPageSave
    let scope: String
    let session: EnvironmentStore.SessionIdentity
    var id: String { conflict.id }
}

/// A lost image response and a newer edit are deliberately indistinguishable
/// without a server image receipt. Let the owner review both images; revision
/// preconditions still apply after this explicit replacement decision.
struct BinderPageConflictReviewView: View {
    let context: BinderPageRecoveryReviewContext
    let onResolve: (BinderPageConflictResolution) throws -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsReplacement = false
    @State private var errorMessage: String?

    private var savedPage: DeferredBinderPage? {
        context.attempt.pages.first { $0.pageNumber == context.conflict.pageNumber }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Your cards are already confirmed in inventory. This choice changes only the page positions and image; it does not add or remove copies.")
                    Text("The current page differs from the last confirmed version. A prior upload may also have completed before its response was lost.")
                        .foregroundStyle(.secondary)
                }
                Section("Saved scan") {
                    if let savedPage {
                        Text("Captured \(savedPage.capturedAt)")
                        Text("\(savedPage.placements.count) card positions · \(context.attempt.committedCopyIDs(on: savedPage).count) confirmed copies")
                        if let data = savedPage.imageData, let image = UIImage(data: data) {
                            Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Saved binder page scan")
                        } else { Text("No replacement image was requested.").foregroundStyle(.secondary) }
                        ForEach(savedPage.placements) { placement in
                            Text("Pocket \(placement.slotIndex + 1): \(placement.name)").font(.caption)
                        }
                    }
                }
                Section("Current page") {
                    if let current = context.conflict.currentPage {
                        Text("Revision \(current.revision) · captured \(current.capturedAt)")
                        if let value = current.imageUrl,
                           let url = URL(string: value, relativeTo: context.session.configuration.normalizedURL)?.absoluteURL {
                            if url.isFileURL, let image = UIImage(contentsOfFile: url.path) {
                                Image(uiImage: image).resizable().scaledToFit()
                            } else {
                                AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() }
                                    .accessibilityLabel("Current binder page image")
                            }
                        } else { Text("This page has no image.").foregroundStyle(.secondary) }
                        ForEach(current.placements) { placement in
                            Text("Pocket \(placement.slotIndex + 1): \(placement.name)").font(.caption)
                        }
                    } else { Text("This page no longer exists.") }
                }
                Section {
                    Button("Keep current page") { resolve(.keepCurrent) }
                    Button("Replace with saved scan", role: .destructive) { confirmsReplacement = true }
                } footer: {
                    Text("Keeping the current page discards these saved page changes and finishes this page's recovery. Replacement is allowed only if the reviewed revision is still current. Your confirmed inventory copies are preserved either way.")
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Review page \(context.conflict.pageNumber)")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .confirmationDialog("Replace the reviewed page with this saved scan?", isPresented: $confirmsReplacement, titleVisibility: .visible) {
                Button("Replace page", role: .destructive) { resolve(.replaceWithSavedScan) }
            } message: { Text("Its saved positions and selected scan image will replace the current page. Your inventory copies will not change.") }
        }
    }

    private func resolve(_ resolution: BinderPageConflictResolution) {
        guard environmentStore.matches(context.session) else { dismiss(); return }
        do { try onResolve(resolution); dismiss() }
        catch { errorMessage = error.localizedDescription }
    }
}
