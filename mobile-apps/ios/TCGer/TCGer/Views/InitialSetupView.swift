import SwiftUI

struct InitialSetupView: View {
    @Binding var isSubmitting: Bool

    let onCreateAdmin: (_ email: String, _ password: String, _ username: String?) -> Void
    let onRefreshStatus: () -> Void

    @State private var email = ""
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var validationMessage: String?

    var body: some View {
        Form {
            Section(
                header: Text("Initial Admin Setup"),
                footer: Text("Create the first administrator account for this server.")
            ) {
                TextField("Admin Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)

                TextField("Username (optional)", text: $username)
                    .textContentType(.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)

                SecureField("Password", text: $password)
                    .textContentType(.newPassword)

                SecureField("Confirm Password", text: $confirmPassword)
                    .textContentType(.newPassword)
            }

            if let validationMessage {
                Section {
                    Text(validationMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }

            Section {
                Button {
                    submit()
                } label: {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Label("Create Admin Account", systemImage: "person.crop.circle.badge.checkmark")
                    }
                }
                .disabled(isSubmitting)

                Button("Re-check Setup Status", action: onRefreshStatus)
                    .disabled(isSubmitting)
            }
        }
        .navigationTitle("Server Setup")
    }

    private func submit() {
        validationMessage = nil

        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedEmail.isEmpty else {
            validationMessage = "Email is required."
            return
        }

        guard !password.isEmpty else {
            validationMessage = "Password is required."
            return
        }

        guard password.count >= 8 else {
            validationMessage = "Password must be at least 8 characters."
            return
        }

        guard password == confirmPassword else {
            validationMessage = "Passwords do not match."
            return
        }

        onCreateAdmin(
            trimmedEmail,
            password,
            trimmedUsername.isEmpty ? nil : trimmedUsername
        )
    }
}
