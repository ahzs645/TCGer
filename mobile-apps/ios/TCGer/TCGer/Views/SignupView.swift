import SwiftUI

struct SignupView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Binding var isSubmitting: Bool

    let onSignup: (_ email: String, _ password: String, _ username: String) -> Void
    let onCancel: () -> Void

    @State private var email = ""
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var validationMessage: String?

    var body: some View {
        Form {
            Section(header: Text("Create Account"), footer: footerText) {
                TextField("Username", text: $username)
                    .textContentType(.username)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)

                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
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
                        Label("Create Account", systemImage: "person.badge.plus")
                    }
                }
                .disabled(isSubmitting)

                Button("Back to Sign In", action: onCancel)
                    .disabled(isSubmitting)
            }
        }
        .navigationTitle("Sign Up")
    }

    private func submit() {
        validationMessage = nil

        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedUsername.isEmpty else {
            validationMessage = "Username is required."
            return
        }

        guard trimmedUsername.count >= 3 else {
            validationMessage = "Username must be at least 3 characters."
            return
        }

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

        onSignup(trimmedEmail, password, trimmedUsername)
    }

    private var footerText: some View {
        Text("Your account is created on the configured TCG Manager server.")
    }
}
