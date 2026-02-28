'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LogIn } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setDemoMode } from '@/lib/demo-mode';
import { demoLogin } from '@/lib/api/demo-adapter';
import { useAuthStore } from '@/stores/auth';

export default function DemoLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('demo@tcger.app');
  const [password, setPassword] = useState('');
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
      router.push('/');
    }, 800);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo & Branding */}
        <div className="flex flex-col items-center space-y-3">
          <Image
            src="/logo.svg"
            alt="TCGer logo"
            width={56}
            height={56}
            className="dark:invert"
          />
          <div className="space-y-1 text-center">
            <h1 className="font-heading text-3xl font-bold tracking-tight">TCGer</h1>
            <p className="text-sm text-muted-foreground">
              Unified hub for Yu-Gi-Oh!, Magic, and Pok&eacute;mon collections.
            </p>
          </div>
        </div>

        {/* Login Card */}
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              <LogIn className="h-5 w-5" />
              Sign In
            </CardTitle>
            <CardDescription>Enter your credentials to access your collection.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="demo-email">Email</Label>
                <Input
                  id="demo-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="demo-password">Password</Label>
                <div className="relative">
                  <Input
                    id="demo-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>

              <Button type="button" variant="ghost" className="w-full" disabled>
                Don&apos;t have an account? Sign up
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo notice */}
        <p className="text-center text-xs text-muted-foreground">
          This is a demo interface. No real data is stored or transmitted.
        </p>
      </div>
    </div>
  );
}
