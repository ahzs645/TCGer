import SwiftUI

struct ActivityView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var notifications: [AppNotification] = []
    @State private var isLoading = true
    @State private var isMarkingAllRead = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private var unread: [AppNotification] {
        notifications.filter { !$0.read }
    }

    private var earlier: [AppNotification] {
        notifications.filter(\.read)
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                content
            } else {
                NavigationStack { content }
            }
        }
    }

    private var content: some View {
        Group {
            if environmentStore.serverConfiguration.isOnDevice {
                ContentUnavailableView(
                    "Connect a Server for Activity",
                    systemImage: "bell",
                    description: Text("Trade requests, price alerts, and server updates appear here.")
                )
            } else if isLoading && notifications.isEmpty {
                ProgressView("Loading activity…")
            } else if let errorMessage, notifications.isEmpty {
                ErrorView(title: "Couldn’t Load Activity", message: errorMessage) {
                    Task { await load() }
                }
            } else if notifications.isEmpty {
                ContentUnavailableView(
                    "No Activity Yet",
                    systemImage: "bell.slash",
                    description: Text("New trade requests, price alerts, and account updates will appear here.")
                )
            } else {
                List {
                    if !unread.isEmpty {
                        Section("New") {
                            notificationRows(unread)
                        }
                    }

                    if !earlier.isEmpty {
                        Section("Earlier") {
                            notificationRows(earlier)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Activity")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if !unread.isEmpty {
                    Button {
                        Task { await markAllRead() }
                    } label: {
                        if isMarkingAllRead {
                            ProgressView()
                        } else {
                            Label("Mark All Read", systemImage: "checkmark.circle")
                        }
                    }
                    .disabled(isMarkingAllRead)
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .alert(
            "Activity",
            isPresented: Binding(
                get: { errorMessage != nil && !notifications.isEmpty },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    @ViewBuilder
    private func notificationRows(_ items: [AppNotification]) -> some View {
        ForEach(items) { notification in
            Button {
                guard !notification.read else { return }
                Task { await markRead(notification) }
            } label: {
                NotificationActivityRow(notification: notification)
            }
            .buttonStyle(.plain)
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                if !notification.read {
                    Button {
                        Task { await markRead(notification) }
                    } label: {
                        Label("Mark Read", systemImage: "checkmark")
                    }
                    .tint(.accentColor)
                }
            }
        }
    }

    @MainActor
    private func load() async {
        guard !environmentStore.serverConfiguration.isOnDevice else {
            isLoading = false
            return
        }
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in is required to view activity."
            return
        }

        isLoading = notifications.isEmpty
        errorMessage = nil
        do {
            let loaded = try await apiService.getNotifications(
                config: environmentStore.serverConfiguration,
                token: token
            )
            guard !Task.isCancelled else { return }
            notifications = loaded
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func markRead(_ notification: AppNotification) async {
        guard let token = environmentStore.authToken else { return }
        do {
            let updated = try await apiService.markNotificationRead(
                config: environmentStore.serverConfiguration,
                token: token,
                notificationID: notification.id
            )
            if let index = notifications.firstIndex(where: { $0.id == notification.id }) {
                notifications[index] = updated
            }
            HapticManager.impact(.light)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func markAllRead() async {
        guard let token = environmentStore.authToken else { return }
        isMarkingAllRead = true
        defer { isMarkingAllRead = false }
        do {
            try await apiService.markAllNotificationsRead(
                config: environmentStore.serverConfiguration,
                token: token
            )
            for index in notifications.indices {
                notifications[index].read = true
            }
            HapticManager.notification(.success)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct NotificationActivityRow: View {
    let notification: AppNotification

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: notification.category.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(notification.read ? Color.secondary : Color.accentColor)
                .frame(width: 36, height: 36)
                .background(
                    (notification.read ? Color.secondary : Color.accentColor).opacity(0.12),
                    in: Circle()
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(notification.title)
                    .font(.subheadline.weight(notification.read ? .medium : .semibold))
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(notification.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let createdDate = notification.createdDate {
                    Text(createdDate, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            if !notification.read {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(notification.read ? "Read" : "Unread")
        .accessibilityHint(notification.read ? "" : "Marks this activity as read")
    }
}
