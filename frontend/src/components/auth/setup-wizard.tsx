"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { signUp, signIn } from "@/lib/auth-client";
import { toAuthUser } from "@/lib/auth-helpers";
import { promoteToAdmin } from "@/lib/api/auth";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

export function SetupWizard() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(false);

  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();

    if (!normalizedUsername) {
      setError("Username is required");
      return;
    }

    setLoading(true);

    try {
      const result = await signIn.username({
        username: normalizedUsername,
        password,
      });

      if (result.error) {
        setError(result.error.message ?? "Login failed");
        setLoading(false);
        return;
      }

      // Promote to admin after login
      await promoteToAdmin();

      if (result.data) {
        const user = toAuthUser(result.data.user as Record<string, unknown>);
        user.isAdmin = true;
        setAuth(user, result.data.token ?? undefined);
      }

      router.push("/collections");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedUsername.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    if (!normalizedEmail) {
      setError("Email is required");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      // Step 1: Sign up via Better Auth
      const result = await signUp.email({
        email: normalizedEmail,
        password,
        name: normalizedUsername,
        username: normalizedUsername,
      });

      if (result.error) {
        setError(result.error.message ?? "Setup failed");
        setLoading(false);
        return;
      }

      // Step 2: Promote the new user to admin
      await promoteToAdmin();

      if (result.data) {
        const user = toAuthUser(result.data.user as Record<string, unknown>);
        user.isAdmin = true;
        setAuth(user, result.data.token ?? undefined);
      }

      router.push("/collections");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-4"
      data-oid="t7kw7wp"
    >
      <div className="w-full max-w-md space-y-6" data-oid="bx-t-ix">
        <div
          className="flex flex-col items-center space-y-2"
          data-oid="xnzbvw3"
        >
          <Image
            src="/logo.svg"
            alt="TCGer logo"
            width={64}
            height={64}
            className="dark:invert"
            data-oid="go:vb.x"
          />

          <h1 className="text-2xl font-bold" data-oid="szuhb5c">
            Welcome to TCGer
          </h1>
          <p
            className="text-center text-sm text-muted-foreground"
            data-oid="j60y.r."
          >
            {isLoginMode
              ? "Sign in to your account"
              : "Let's get started by creating your admin account"}
          </p>
        </div>

        <form
          onSubmit={isLoginMode ? handleLogin : handleSubmit}
          className="space-y-4"
          data-oid="kzvg67t"
        >
          {error && (
            <div
              className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              data-oid="xrk:mzs"
            >
              <AlertCircle className="h-4 w-4" data-oid="t-q35zo" />
              <span data-oid="6mm7n1c">{error}</span>
            </div>
          )}

          <div className="space-y-2" data-oid="jyru97a">
            <Label htmlFor="username" data-oid="gnr9yq5">
              Username
            </Label>
            <Input
              id="username"
              type="text"
              placeholder={isLoginMode ? "Your username" : "Admin"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
              data-oid="5_xih0n"
            />
          </div>

          {!isLoginMode && (
            <div className="space-y-2" data-oid="pjkttjj">
              <Label htmlFor="email" data-oid="i.uk6x6">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                data-oid="ke7ud_w"
              />
            </div>
          )}

          <div className="space-y-2" data-oid="9gjqz4m">
            <Label htmlFor="password" data-oid="fg5-6sd">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={isLoginMode ? undefined : 8}
              autoComplete={isLoginMode ? "current-password" : "new-password"}
              data-oid="_dlpsb-"
            />

            {!isLoginMode && (
              <p className="text-xs text-muted-foreground" data-oid="iwmkat-">
                Must be at least 8 characters
              </p>
            )}
          </div>

          {!isLoginMode && (
            <div className="space-y-2" data-oid="gvdz3rm">
              <Label htmlFor="confirmPassword" data-oid="rqiovqy">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="new-password"
                data-oid="y1rl3l9"
              />
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading}
            data-oid="_8cryeh"
          >
            {loading
              ? isLoginMode
                ? "Signing in..."
                : "Creating Admin Account..."
              : isLoginMode
                ? "Sign In"
                : "Create Admin Account"}
          </Button>

          <div className="text-center" data-oid=":9jawln">
            <button
              type="button"
              onClick={() => {
                setIsLoginMode(!isLoginMode);
                setError("");
              }}
              className="text-sm text-muted-foreground hover:text-foreground underline"
              disabled={loading}
              data-oid="c7-7_q8"
            >
              {isLoginMode
                ? "Need to create an admin account?"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
