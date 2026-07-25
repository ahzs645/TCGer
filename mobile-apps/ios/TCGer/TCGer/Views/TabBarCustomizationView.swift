import SwiftUI

/// Pick which tabs appear in the bottom bar and in what order.
struct TabBarCustomizationView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingResetAlert = false

    private var shownCount: Int {
        environmentStore.visibleTabs.count
    }

    var body: some View {
        List {
            Section {
                ForEach(environmentStore.tabOrder) { tab in
                    row(for: tab)
                }
                .onMove { source, destination in
                    environmentStore.moveTabs(fromOffsets: source, toOffset: destination)
                }
            } header: {
                Text("Tabs")
            } footer: {
                Text("Tap Edit, then drag to reorder. iPhone shows about five tabs at once — anything past that moves into the More list, so put what you use most at the top. Settings always stays available.")
            }

            Section {
                Button("Reset to Default", role: .destructive) {
                    showingResetAlert = true
                }
            } footer: {
                Text(summary)
            }
        }
        .navigationTitle("Tab Bar")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
            }
        }
        .alert("Reset Tab Bar?", isPresented: $showingResetAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) {
                environmentStore.resetTabBar()
            }
        } message: {
            Text("Restores the original tab order and shows every tab again.")
        }
    }

    @ViewBuilder
    private func row(for tab: AppTab) -> some View {
        HStack(spacing: 12) {
            Image(systemName: tab.systemImage)
                .foregroundColor(.accentColor)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(tab.title)
                Text(tab.subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if tab.isPinned {
                Text("Always on")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Toggle("", isOn: Binding(
                    get: { environmentStore.isTabVisible(tab) },
                    set: { environmentStore.setTab(tab, visible: $0) }
                ))
                .labelsHidden()
                .accessibilityLabel("Show \(tab.title)")
            }
        }
        .padding(.vertical, 2)
    }

    private var summary: String {
        let hidden = environmentStore.hiddenTabs.count
        if hidden == 0 {
            return "Showing all \(shownCount) tabs."
        }
        return "Showing \(shownCount) of \(AppTab.allCases.count) tabs. Hiding a tab also hides the screen behind it."
    }
}

#Preview {
    NavigationStack {
        TabBarCustomizationView()
            .environmentObject(EnvironmentStore())
    }
}
