//
//  ProfileView.swift
//  TCGer
//

import SwiftUI

struct ProfileView: View {
    private enum FocusedField: Hashable {
        case username
        case email
        case currentPassword
        case newPassword
        case confirmPassword
    }

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: FocusedField?

    @State private var profile: APIService.UserProfile?
    @State private var isLoading = true
    @State private var errorMessage: String?

    // Edit mode
    @State private var isEditingProfile = false
    @State private var editUsername = ""
    @State private var editEmail = ""
    @State private var isSavingProfile = false
    @State private var profileSaveError: String?

    // Password change mode
    @State private var isChangingPassword = false
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSavingPassword = false
    @State private var passwordError: String?
    @State private var passwordSuccess = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading profile...")
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundColor(.orange)
                        Text("Failed to load profile")
                            .font(.headline)
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Try Again") {
                            Task { await loadProfile() }
                        }
                    }
                    .padding()
                } else if let profile = profile {
                    Form {
                        profileSection(profile)

                        if !isEditingProfile {
                            passwordSection
                        }
                    }
                    .navigationTitle("Profile")
                    .navigationBarTitleDisplayMode(.large)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("Done") {
                                dismiss()
                            }
                        }
                    }
                }
            }
            .task {
                await loadProfile()
            }
        }
    }

    @ViewBuilder
    private func profileSection(_ profile: APIService.UserProfile) -> some View {
        Section {
            if isEditingProfile {
                if let error = profileSaveError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityLabel("Profile error: \(error)")
                }

                TextField("Username", text: $editUsername)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .username)
                    .submitLabel(.next)
                    .onSubmit {
                        focusedField = .email
                    }

                TextField("Email", text: $editEmail)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .focused($focusedField, equals: .email)
                    .submitLabel(.done)
                    .onSubmit {
                        guard !isSavingProfile else { return }
                        Task { await saveProfile() }
                    }

                Button {
                    Task { await saveProfile() }
                } label: {
                    if isSavingProfile {
                        HStack {
                            ProgressView()
                            Text("Saving…")
                        }
                    } else {
                        Label("Save Profile", systemImage: "checkmark")
                    }
                }
                .disabled(isSavingProfile)

                Button("Cancel", role: .cancel, action: cancelEditProfile)
                    .disabled(isSavingProfile)
            } else {
                // Display mode
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Label {
                            Text("Username")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } icon: {
                            Image(systemName: "person.fill")
                                .font(.caption)
                        }
                        Text(profile.username ?? "Not set")
                            .font(.body)
                    }
                    Spacer()
                }

                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Label {
                            Text("Email")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } icon: {
                            Image(systemName: "envelope.fill")
                                .font(.caption)
                        }
                        Text(profile.email)
                            .font(.body)
                    }
                    Spacer()
                }

                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Label {
                            Text("Member Since")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } icon: {
                            Image(systemName: "calendar")
                                .font(.caption)
                        }
                        Text(formatDate(profile.createdAt))
                            .font(.body)
                    }
                    Spacer()
                }

                if profile.isAdmin {
                    HStack {
                        VStack(alignment: .leading, spacing: 8) {
                            Label {
                                Text("Role")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            } icon: {
                                Image(systemName: "shield.fill")
                                    .font(.caption)
                            }
                            Text("Administrator")
                                .font(.body)
                                .foregroundColor(.blue)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(6)
                        }
                        Spacer()
                    }
                }

                Button(action: startEditProfile) {
                    Label("Edit Profile", systemImage: "pencil")
                }
            }
        } header: {
            Text("Account Information")
        }
    }

    @ViewBuilder
    private var passwordSection: some View {
        Section {
            if isChangingPassword {
                if let error = passwordError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityLabel("Password error: \(error)")
                }

                if passwordSuccess {
                    Label("Password changed successfully", systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.green)
                        .accessibilityAddTraits(.isStaticText)
                }

                SecureField("Current Password", text: $currentPassword)
                    .textContentType(.password)
                    .focused($focusedField, equals: .currentPassword)
                    .submitLabel(.next)
                    .onSubmit {
                        focusedField = .newPassword
                    }

                SecureField("New Password (minimum 8 characters)", text: $newPassword)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .newPassword)
                    .submitLabel(.next)
                    .onSubmit {
                        focusedField = .confirmPassword
                    }

                SecureField("Confirm New Password", text: $confirmPassword)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .confirmPassword)
                    .submitLabel(.done)
                    .onSubmit {
                        guard !isSavingPassword,
                              !currentPassword.isEmpty,
                              !newPassword.isEmpty,
                              !confirmPassword.isEmpty else { return }
                        Task { await changePassword() }
                    }

                Button {
                    Task { await changePassword() }
                } label: {
                    if isSavingPassword {
                        HStack {
                            ProgressView()
                            Text("Changing Password…")
                        }
                    } else {
                        Label("Change Password", systemImage: "key.fill")
                    }
                }
                .disabled(isSavingPassword || currentPassword.isEmpty || newPassword.isEmpty || confirmPassword.isEmpty)

                Button("Cancel", role: .cancel, action: cancelPasswordChange)
                    .disabled(isSavingPassword)
            } else {
                Text("Change your password to keep your account secure")
                    .font(.footnote)
                    .foregroundColor(.secondary)

                Button(action: startPasswordChange) {
                    Label("Change Password", systemImage: "key.fill")
                }
            }
        } header: {
            Text("Security")
        }
    }

    // MARK: - Helper Functions

    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let date = formatter.date(from: dateString) else {
            return dateString
        }

        let displayFormatter = DateFormatter()
        displayFormatter.dateStyle = .long
        displayFormatter.timeStyle = .none

        return displayFormatter.string(from: date)
    }

    // MARK: - API Functions

    private func loadProfile() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        let api = APIService()

        do {
            let loadedProfile = try await api.getUserProfile(
                config: environmentStore.serverConfiguration,
                token: token
            )

            await MainActor.run {
                self.profile = loadedProfile
                environmentStore.applyUserProfile(loadedProfile)
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }

    private func startEditProfile() {
        guard let profile = profile else { return }
        editUsername = profile.username ?? ""
        editEmail = profile.email
        profileSaveError = nil
        isEditingProfile = true
        focusedField = .username
    }

    private func cancelEditProfile() {
        focusedField = nil
        isEditingProfile = false
        profileSaveError = nil
    }

    private func saveProfile() async {
        guard let token = environmentStore.authToken,
              let currentProfile = profile else {
            return
        }

        profileSaveError = nil
        isSavingProfile = true

        let api = APIService()

        // Determine what changed
        var usernameUpdate: String?
        var emailUpdate: String?

        if editUsername != (currentProfile.username ?? "") {
            usernameUpdate = editUsername
        }

        if editEmail != currentProfile.email {
            emailUpdate = editEmail
        }

        // If nothing changed, just exit edit mode
        if usernameUpdate == nil && emailUpdate == nil {
            await MainActor.run {
                focusedField = nil
                isEditingProfile = false
                isSavingProfile = false
            }
            return
        }

        do {
            let updatedProfile = try await api.updateUserProfile(
                config: environmentStore.serverConfiguration,
                token: token,
                username: usernameUpdate,
                email: emailUpdate
            )

            await MainActor.run {
                // Update the profile with new data
                if let currentProfile = self.profile {
                    self.profile = APIService.UserProfile(
                        id: updatedProfile.id,
                        email: updatedProfile.email,
                        username: updatedProfile.username,
                        isAdmin: updatedProfile.isAdmin,
                        showCardNumbers: updatedProfile.showCardNumbers,
                        showPricing: updatedProfile.showPricing,
                        createdAt: currentProfile.createdAt
                    )
                }

                // Update environment store username if changed
                if let usernameUpdate = usernameUpdate {
                    environmentStore.credentials.username = usernameUpdate
                }
                if let profile = self.profile {
                    environmentStore.applyUserProfile(profile)
                }

                focusedField = nil
                isEditingProfile = false
                isSavingProfile = false
            }
        } catch {
            await MainActor.run {
                profileSaveError = error.localizedDescription
                isSavingProfile = false
            }
        }
    }

    private func startPasswordChange() {
        currentPassword = ""
        newPassword = ""
        confirmPassword = ""
        passwordError = nil
        passwordSuccess = false
        isChangingPassword = true
        focusedField = .currentPassword
    }

    private func cancelPasswordChange() {
        focusedField = nil
        isChangingPassword = false
        currentPassword = ""
        newPassword = ""
        confirmPassword = ""
        passwordError = nil
        passwordSuccess = false
    }

    private func changePassword() async {
        guard let token = environmentStore.authToken else {
            return
        }

        passwordError = nil
        passwordSuccess = false

        // Validate passwords
        if newPassword != confirmPassword {
            passwordError = "Passwords do not match"
            return
        }

        if newPassword.count < 8 {
            passwordError = "Password must be at least 8 characters"
            return
        }

        isSavingPassword = true

        let api = APIService()

        do {
            try await api.changePassword(
                config: environmentStore.serverConfiguration,
                token: token,
                currentPassword: currentPassword,
                newPassword: newPassword
            )

            await MainActor.run {
                focusedField = nil
                passwordSuccess = true
                isSavingPassword = false
                currentPassword = ""
                newPassword = ""
                confirmPassword = ""

                // Auto-close after 2 seconds
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    isChangingPassword = false
                    passwordSuccess = false
                }
            }
        } catch {
            await MainActor.run {
                passwordError = error.localizedDescription
                isSavingPassword = false
            }
        }
    }
}

#Preview {
    ProfileView()
        .environmentObject(EnvironmentStore())
}
