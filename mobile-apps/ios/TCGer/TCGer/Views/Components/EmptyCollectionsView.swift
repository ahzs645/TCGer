import SwiftUI

struct EmptyCollectionsView: View {
    let onCreate: () -> Void

    var body: some View {
        ScrollView {
            ContentUnavailableView {
                Label("No Binders Yet", systemImage: "folder.badge.plus")
            } description: {
                Text("Create your first binder to start organizing your cards.")
            } actions: {
                Button("Create Binder", systemImage: "plus", action: onCreate)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
            .padding(.vertical, AppSpacing.section)
        }
        .background(Color(.systemBackground))
    }
}

#Preview {
    EmptyCollectionsView(onCreate: {})
}
