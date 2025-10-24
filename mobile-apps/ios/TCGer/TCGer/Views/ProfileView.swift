//
//  ProfileView.swift
//  TCGer
//

import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

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
        NavigationView {
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
                // Edit mode
                VStack(alignment: .leading, spacing: 16) {
                    if let error = profileSaveError {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                        .padding()
                        .background(Color.red.opacity(0.1))
                        .cornerRadius(8)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Username")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        TextField("Username", text: $editUsername)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Email")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        TextField("Email", text: $editEmail)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                            .keyboardType(.emailAddress)
                    }

                    HStack(spacing: 12) {
                        Button(action: { Task { await saveProfile() } }) {
                            HStack {
                                if isSavingProfile {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "checkmark")
                                }
                                Text(isSavingProfile ? "Saving..." : "Save")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isSavingProfile)

                        Button(action: cancelEditProfile) {
                            HStack {
                                Image(systemName: "xmark")
                                Text("Cancel")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(isSavingProfile)
                    }
                }
                .padding(.vertical, 8)
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
                    HStack {
                        Image(systemName: "pencil")
                        Text("Edit Profile")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        } header: {
            Text("Account Information")
        }
    }

    @ViewBuilder
    private var passwordSection: some View {
        Section {
            if isChangingPassword {
                VStack(alignment: .leading, spacing: 16) {
                    if let error = passwordError {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                        .padding()
                        .background(Color.red.opacity(0.1))
                        .cornerRadius(8)
                    }

                    if passwordSuccess {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Password changed successfully!")
                                .font(.caption)
                                .foregroundColor(.green)
                        }
                        .padding()
                        .background(Color.green.opacity(0.1))
                        .cornerRadius(8)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Current Password")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        SecureField("Enter current password", text: $currentPassword)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("New Password")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        SecureField("Enter new password (min 8 characters)", text: $newPassword)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Confirm New Password")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        SecureField("Confirm new password", text: $confirmPassword)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                    }

                    HStack(spacing: 12) {
                        Button(action: { Task { await changePassword() } }) {
                            HStack {
                                if isSavingPassword {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "key.fill")
                                }
                                Text(isSavingPassword ? "Changing..." : "Change Password")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isSavingPassword || currentPassword.isEmpty || newPassword.isEmpty || confirmPassword.isEmpty)

                        Button(action: cancelPasswordChange) {
                            HStack {
                                Image(systemName: "xmark")
                                Text("Cancel")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(isSavingPassword)
                    }
                }
                .padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Change your password to keep your account secure")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Button(action: startPasswordChange) {
                        HStack {
                            Image(systemName: "key.fill")
                            Text("Change Password")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.vertical, 4)
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
    }

    private func cancelEditProfile() {
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

                // Update environment store email if changed
                if let emailUpdate = emailUpdate {
                    environmentStore.credentials.email = emailUpdate
                }

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
    }

    private func cancelPasswordChange() {
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
