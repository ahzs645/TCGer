"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";

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
import { signIn } from "@/lib/auth-client";
import { toAuthUser } from "@/lib/auth-helpers";
import { useAuthStore } from "@/stores/auth";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignup?: () => void;
}

export function LoginDialog({
  open,
  onOpenChange,
  onSwitchToSignup,
}: LoginDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
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
      setPassword("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-oid="9w.b_r.">
      <DialogContent className="sm:max-w-md" data-oid="2itrf8o">
        <DialogHeader data-oid="3v7v9:b">
          <DialogTitle className="flex items-center gap-2" data-oid="hhh33gi">
            <LogIn className="h-5 w-5" data-oid="j13fuxp" />
            Sign In
          </DialogTitle>
          <DialogDescription data-oid="whem2yn">
            Enter your credentials to access your TCG collection.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" data-oid="0v_6hgc">
          {error && (
            <div
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              data-oid="pfr6:kg"
            >
              {error}
            </div>
          )}

          <div className="space-y-2" data-oid="-3aexmm">
            <Label htmlFor="username" data-oid="wbc..:l">
              Username
            </Label>
            <Input
              id="username"
              type="text"
              placeholder="Your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              data-oid="h3yrzcu"
            />
          </div>

          <div className="space-y-2" data-oid="peg-8ge">
            <Label htmlFor="password" data-oid="70fpazf">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              data-oid="_:l2brg"
            />
          </div>

          <div className="flex flex-col gap-2" data-oid="p3gaejv">
            <Button
              type="submit"
              disabled={loading}
              className="w-full"
              data-oid="kt.ph5q"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>

            {onSwitchToSignup && (
              <Button
                type="button"
                variant="ghost"
                onClick={onSwitchToSignup}
                className="w-full"
                data-oid="9x:xkbl"
              >
                Don&apos;t have an account? Sign up
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
