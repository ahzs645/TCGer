'use client';

import { LogIn, LogOut, Moon, Settings, Sparkles, Sun, User } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';

import { AccountSettingsDialog } from '@/components/account/account-settings-dialog';
import { ProfileDialog } from '@/components/account/profile-dialog';
import { LoginDialog } from '@/components/auth/login-dialog';
import { SignupDialog } from '@/components/auth/signup-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { logout } from '@/lib/api/auth';
import { isDemoMode, setDemoMode } from '@/lib/demo-mode';
import { useAuthStore } from '@/stores/auth';

export function UserMenu() {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const { user, token, isAuthenticated, clearAuth } = useAuthStore();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleLogout = async () => {
    const wasDemo = isDemoMode();
    if (token) {
      try {
        await logout(token);
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    if (wasDemo) {
      setDemoMode(false);
    }
    clearAuth();
    if (wasDemo) {
      router.push('/demo');
    }
  };

  const handleSwitchToSignup = () => {
    setLoginOpen(false);
    setSignupOpen(true);
  };

  const handleSwitchToLogin = () => {
    setSignupOpen(false);
    setLoginOpen(true);
  };

  if (!isAuthenticated) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => setLoginOpen(true)}>
          <LogIn className="mr-2 h-4 w-4" />
          Sign In
        </Button>
        <LoginDialog
          open={loginOpen}
          onOpenChange={setLoginOpen}
          onSwitchToSignup={handleSwitchToSignup}
        />
        <SignupDialog
          open={signupOpen}
          onOpenChange={setSignupOpen}
          onSwitchToLogin={handleSwitchToLogin}
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full border">
            <User className="h-5 w-5" />
            <span className="sr-only">Open user menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user?.username || 'User'}</p>
              <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Account & preferences
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(isDark ? 'light' : 'dark')}>
            {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            {isDark ? 'Light mode' : 'Dark mode'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
