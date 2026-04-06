"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setDemoMode } from "@/lib/demo-mode";
import { demoLogin } from "@/lib/api/demo-adapter";
import { useAuthStore } from "@/stores/auth";

export default function DemoLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@tcger.app");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Enable demo mode, seed store, set fake auth, then redirect to main app
    setTimeout(() => {
      setDemoMode(true);
      const { user, token } = demoLogin();
      useAuthStore.getState().setAuth(user, token);
      router.push("/demo/dashboard");
    }, 800);
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4"
      data-oid="vjpsv1o"
    >
      <div className="w-full max-w-md space-y-8" data-oid="3j.516u">
        {/* Logo & Branding */}
        <div
          className="flex flex-col items-center space-y-3"
          data-oid="zmx:k0s"
        >
          <Image
            src="/logo.svg"
            alt="TCGer logo"
            width={56}
            height={56}
            className="dark:invert"
            data-oid="3-dxyq8"
          />

          <div className="space-y-1 text-center" data-oid="7ba4azi">
            <h1
              className="font-heading text-3xl font-bold tracking-tight"
              data-oid="xza:wxw"
            >
              TCGer
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="lv:::gl">
              Unified hub for Yu-Gi-Oh!, Magic, and Pok&eacute;mon collections.
            </p>
          </div>
        </div>

        {/* Login Card */}
        <Card data-oid="wo5z_ju">
          <CardHeader className="space-y-1" data-oid="e1x_6uh">
            <CardTitle
              className="flex items-center gap-2 text-xl"
              data-oid="hmho1-t"
            >
              <LogIn className="h-5 w-5" data-oid="hmj4e_o" />
              Sign In
            </CardTitle>
            <CardDescription data-oid="vieydwy">
              Enter your credentials to access your collection.
            </CardDescription>
          </CardHeader>
          <CardContent data-oid="aer7wwy">
            <form
              onSubmit={handleSubmit}
              className="space-y-4"
              data-oid="qx_u6.k"
            >
              <div className="space-y-2" data-oid="6uaiyvw">
                <Label htmlFor="demo-email" data-oid="j-taru9">
                  Email
                </Label>
                <Input
                  id="demo-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  data-oid="qt-2w3m"
                />
              </div>

              <div className="space-y-2" data-oid="3x7n069">
                <Label htmlFor="demo-password" data-oid="j4c31a7">
                  Password
                </Label>
                <div className="relative" data-oid="jigue4z">
                  <Input
                    id="demo-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="pr-10"
                    data-oid="umy_jjw"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    data-oid="wvtjc8-"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" data-oid="jd8blwv" />
                    ) : (
                      <Eye className="h-4 w-4" data-oid="9oacthk" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
                data-oid="-.2mf0g"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled
                data-oid="9c1g-_j"
              >
                Don&apos;t have an account? Sign up
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo notice */}
        <p
          className="text-center text-xs text-muted-foreground"
          data-oid="dc_d8c7"
        >
          This is a demo interface. No real data is stored or transmitted.
        </p>
      </div>
    </div>
  );
}
