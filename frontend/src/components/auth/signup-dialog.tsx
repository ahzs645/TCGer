"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";
import { toAuthUser } from "@/lib/auth-helpers";
import { useAuthStore } from "@/stores/auth";

interface SignupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToLogin?: () => void;
}

export function SignupDialog({
  open,
  onOpenChange,
  onSwitchToLogin,
}: SignupDialogProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);

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
      const result = await signUp.email({
        email: normalizedEmail,
        password,
        name: normalizedUsername,
        username: normalizedUsername,
      });

      if (result.error) {
        setError(result.error.message ?? "Signup failed");
        return;
      }

      if (result.data) {
        const sessionToken = result.data.token ?? undefined;
        setAuth(
          toAuthUser(result.data.user as Record<string, unknown>),
          sessionToken,
        );
      }

      setUsername("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-oid="q8kp3wn">
      <DialogContent className="sm:max-w-md" data-oid="l.h7rlo">
        <DialogHeader data-oid="ko8k-qd">
          <DialogTitle className="flex items-center gap-2" data-oid="369wrs-">
            <UserPlus className="h-5 w-5" data-oid="p541vpg" />
            Create Account
          </DialogTitle>
          <DialogDescription data-oid="5ovtozi">
            Start building your TCG collection today.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" data-oid="__jd--g">
          {error && (
            <div
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              data-oid="6k3sjcc"
            >
              {error}
            </div>
          )}

          <div className="space-y-2" data-oid="0itunnw">
            <Label htmlFor="signup-username" data-oid="6yo5fii">
              Username
            </Label>
            <Input
              id="signup-username"
              type="text"
              placeholder="CardCollector123"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              data-oid="w343zld"
            />
          </div>

          <div className="space-y-2" data-oid="pmgz2nu">
            <Label htmlFor="signup-email" data-oid="currvwf">
              Email
            </Label>
            <Input
              id="signup-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              data-oid="zs9vd60"
            />
          </div>

          <div className="space-y-2" data-oid="rui_zyu">
            <Label htmlFor="signup-password" data-oid="92whbv7">
              Password
            </Label>
            <Input
              id="signup-password"
              type="password"
              placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              data-oid="sj8lbea"
            />
          </div>

          <div className="space-y-2" data-oid="pkt1y:7">
            <Label htmlFor="signup-confirm-password" data-oid="s-p_pt1">
              Confirm Password
            </Label>
            <Input
              id="signup-confirm-password"
              type="password"
              placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              data-oid=".qdyhx:"
            />
          </div>

          <div className="flex flex-col gap-2" data-oid="_uqsvjp">
            <Button
              type="submit"
              disabled={loading}
              className="w-full"
              data-oid="iosybcy"
            >
              {loading ? "Creating account..." : "Create Account"}
            </Button>

            {onSwitchToLogin && (
              <Button
                type="button"
                variant="ghost"
                onClick={onSwitchToLogin}
                className="w-full"
                data-oid="pp30d5j"
              >
                Already have an account? Sign in
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
