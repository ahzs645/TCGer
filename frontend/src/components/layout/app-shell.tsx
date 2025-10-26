'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Search, Table } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getUserPreferences } from '@/lib/api/user-preferences';
import { useAuthStore } from '@/stores/auth';

import { CommandMenu } from '../navigation/command-menu';
import { GameSwitcher } from '../navigation/game-switcher';
import { ThemeToggle } from '../navigation/theme-toggle';
import { UserMenu } from '../navigation/user-menu';

const navigation = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/cards', label: 'Card Search', icon: Search },
  { href: '/collections', label: 'Collections', icon: Table }
];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <PreferenceHydrator />
      <header className="fixed inset-x-0 top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-lg font-heading font-semibold">
              <Image src="/favicon.svg" alt="TCG Manager" width={32} height={32} className="h-8 w-8 dark:invert" />
              TCG Manager
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Button
                    key={item.href}
                    variant={isActive ? 'default' : 'ghost'}
                    size="sm"
                    asChild
                    className={cn(isActive && 'bg-primary text-primary-foreground')}
                  >
                    <Link href={item.href} className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </Button>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <CommandMenu />
            <GameSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="flex-1 bg-muted/20 pt-20">
        <div className="container space-y-6 py-8">{children}</div>
      </main>
    </div>
  );
}

function PreferenceHydrator() {
  const token = useAuthStore((state) => state.token);
  const updateStoredPreferences = useAuthStore((state) => state.updateStoredPreferences);
  const lastSyncedToken = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      lastSyncedToken.current = null;
      return;
    }

    if (lastSyncedToken.current === token) {
      return;
    }

    let cancelled = false;
    getUserPreferences(token)
      .then((preferences) => {
        if (cancelled) return;
        updateStoredPreferences(preferences);
        lastSyncedToken.current = token;
      })
      .catch((error) => {
        console.error('Failed to refresh user preferences:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [token, updateStoredPreferences]);

  return null;
}
