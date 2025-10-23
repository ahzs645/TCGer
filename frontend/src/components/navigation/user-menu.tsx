'use client';

import { LogIn, LogOut, Settings, Sparkles, User, UserPlus, Waypoints } from 'lucide-react';
import { useState } from 'react';

import { AccountSettingsDialog } from '@/components/account/account-settings-dialog';
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
import { useAuthStore } from '@/stores/auth';

export function UserMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const { user, token, isAuthenticated, clearAuth } = useAuthStore();

  const handleLogout = async () => {
    if (token) {
      try {
        await logout(token);
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    clearAuth();
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
          <DropdownMenuItem>
            <Sparkles className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <Waypoints className="mr-2 h-4 w-4" />
            Module preferences
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
