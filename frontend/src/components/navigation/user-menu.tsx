"use client";

import {
  LogIn,
  LogOut,
  Moon,
  Settings,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { AccountSettingsDialog } from "@/components/account/account-settings-dialog";
import { ProfileDialog } from "@/components/account/profile-dialog";
import { LoginDialog } from "@/components/auth/login-dialog";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { isDemoMode, setDemoMode } from "@/lib/demo-mode";
import { useAuthStore } from "@/stores/auth";

export function UserMenu() {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const { user, isAuthenticated, clearAuth } = useAuthStore();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const handleLogout = async () => {
    const wasDemo = isDemoMode();
    try {
      await signOut();
    } catch (error) {
      console.error("Logout error:", error);
    }
    if (wasDemo) {
      setDemoMode(false);
    }
    clearAuth();
    if (wasDemo) {
      router.push("/demo");
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLoginOpen(true)}
          data-oid="-oost4y"
        >
          <LogIn className="mr-2 h-4 w-4" data-oid="freox99" />
          Sign In
        </Button>
        <LoginDialog
          open={loginOpen}
          onOpenChange={setLoginOpen}
          onSwitchToSignup={handleSwitchToSignup}
          data-oid="pnot1dn"
        />

        <SignupDialog
          open={signupOpen}
          onOpenChange={setSignupOpen}
          onSwitchToLogin={handleSwitchToLogin}
          data-oid="-o0owjk"
        />
      </>
    );
  }

  return (
    <>
      <DropdownMenu data-oid="78tbwbv">
        <DropdownMenuTrigger asChild data-oid="4sopfve">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full border"
            data-oid="ogpramd"
          >
            <User className="h-5 w-5" data-oid="4bk7dkw" />
            <span className="sr-only" data-oid="zg6z36o">
              Open user menu
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" data-oid="-bms3.f">
          <DropdownMenuLabel className="font-normal" data-oid="s1a:2vd">
            <div className="flex flex-col space-y-1" data-oid="do7qmu7">
              <p
                className="text-sm font-medium leading-none"
                data-oid="r6w_pa7"
              >
                {user?.username || "User"}
              </p>
              <p
                className="text-xs leading-none text-muted-foreground"
                data-oid="mbdv4-_"
              >
                {user?.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator data-oid="usirxfm" />
          <DropdownMenuItem
            onSelect={() => setProfileOpen(true)}
            data-oid=".y6n:_r"
          >
            <Sparkles className="mr-2 h-4 w-4" data-oid="5o0ot:j" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setSettingsOpen(true)}
            data-oid="9rn6-:g"
          >
            <Settings className="mr-2 h-4 w-4" data-oid="ngaohp." />
            Account & preferences
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTheme(isDark ? "light" : "dark")}
            data-oid="bj-t8jb"
          >
            {isDark ? (
              <Sun className="mr-2 h-4 w-4" data-oid="oc8ntz4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" data-oid="s6rhv21" />
            )}
            {isDark ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          <DropdownMenuSeparator data-oid="97qi70-" />
          <DropdownMenuItem onSelect={handleLogout} data-oid="5fzf95k">
            <LogOut className="mr-2 h-4 w-4" data-oid="vugobq7" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        data-oid="4zppbxo"
      />
      <AccountSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        data-oid="9b181ik"
      />
    </>
  );
}
