'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, LayoutDashboard, Search, Table } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getAppRoute } from '@/lib/app-routes';
import { cn } from '@/lib/utils';
import { isDemoMode } from '@/lib/demo-mode';
import { getUserPreferences } from '@/lib/api/user-preferences';
import { useAuthStore } from '@/stores/auth';

import { CommandMenu } from '../navigation/command-menu';
import { GameSwitcher } from '../navigation/game-switcher';
import { ThemeToggle } from '../navigation/theme-toggle';
import { UserMenu } from '../navigation/user-menu';

const navigation = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/cards', label: 'Card Search', icon: Search },
  { href: '/collections', label: 'Collections', icon: Table },
  { href: '/wishlists', label: 'Wishlists', icon: Heart }
];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const dashboardHref = getAppRoute('/', pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <PreferenceHydrator />
      <header className="fixed inset-x-0 top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href={dashboardHref} className="flex items-center gap-2 text-lg font-heading font-semibold">
              <Image src="/logo.svg" alt="TCGer logo" width={32} height={32} className="h-8 w-8 dark:invert" />
              TCGer
            </Link>
            {isDemoMode() && (
              <Badge variant="secondary" className="hidden text-xs sm:inline-flex">
                Demo Mode
              </Badge>
            )}
            <nav className="hidden items-center gap-1 md:flex">
              {navigation.map((item) => {
                const href = getAppRoute(item.href, pathname);
                const isActive = pathname === href;
                const Icon = item.icon;
                return (
                  <Button
                    key={item.href}
                    variant={isActive ? 'default' : 'ghost'}
                    size="sm"
                    asChild
                    className={cn(isActive && 'bg-primary text-primary-foreground')}
                  >
                    <Link href={href} className="flex items-center gap-2">
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
      <main className="flex-1 bg-muted/20 pt-20 pb-16 md:pb-0">
        <div className="container space-y-6 py-8">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur md:hidden">
        <div className="flex h-14 items-center justify-around">
          {navigation.map((item) => {
            const href = getAppRoute(item.href, pathname);
            const isActive = pathname === href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors',
                  isActive ? 'text-primary font-medium' : 'text-muted-foreground'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'text-primary')} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
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
