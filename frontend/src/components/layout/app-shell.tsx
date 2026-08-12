"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Heart,
  LayoutDashboard,
  Search,
  LibraryBig,
  Table,
  Layers,
  DollarSign,
  BarChart3,
  Repeat2,
  Package,
  PackageOpen,
  MoreHorizontal,
  X,
  Camera,
  Palette,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ServerFeatures } from "@tcg/api-types";

interface NavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
  feature?: keyof ServerFeatures;
}

/** Extra pages accessible via Quick Actions (⌘K) and mobile "More" menu */
export const secondaryNavigation: NavigationItem[] = [
  { href: "/guides", label: "Guides", icon: Palette },
  { href: "/sets", label: "Sets", icon: LibraryBig },
  { href: "/decks", label: "Decks", icon: Layers, feature: "decks" },
  { href: "/prices", label: "Prices", icon: DollarSign, feature: "prices" },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    feature: "analytics",
  },
  { href: "/trades", label: "Trades", icon: Repeat2, feature: "trades" },
  { href: "/sealed", label: "Sealed", icon: Package, feature: "sealed" },
];

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CatalogDownloadPrompt } from "@/components/catalog/catalog-download-prompt";
import { getAppRoute } from "@/lib/app-routes";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/demo-mode";
import { getUserPreferences } from "@/lib/api/user-preferences";
import { isFeatureAvailable, useServerFeatures } from "@/lib/api/health";
import { useAuthStore } from "@/stores/auth";

import { CommandMenu } from "../navigation/command-menu";
import { GameSwitcher } from "../navigation/game-switcher";
import { UserMenu } from "../navigation/user-menu";

const navigation: NavigationItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/packs", label: "Open Packs", icon: PackageOpen },
  { href: "/cards", label: "Card Search", icon: Search },
  { href: "/scan", label: "Scan", icon: Camera },
  { href: "/collections", label: "Collections", icon: Table },
  { href: "/wishlists", label: "Wishlists", icon: Heart },
];

/**
 * /scan needs the server-side hash store and upload API, so in demo mode it can
 * only say "disabled". Spending one of the five desktop slots — and one of the
 * three mobile tabs — on a dead end is a poor first impression, so demo mode
 * drops it from the primary nav and keeps it reachable from More.
 */
function primaryNavigationFor(demoMode: boolean): NavigationItem[] {
  return demoMode
    ? navigation.filter((item) => item.href !== "/scan")
    : navigation;
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const dashboardHref = getAppRoute("/", pathname);
  const features = useServerFeatures();
  const demoMode = isDemoMode();
  const availableSecondaryNavigation = secondaryNavigation.filter(
    (item) =>
      demoMode || !item.feature || isFeatureAvailable(features, item.feature),
  );
  const primaryNavigation = primaryNavigationFor(demoMode);
  const mobileNavPrimary = primaryNavigation.slice(0, 3);
  const mobileNavSecondary = [
    ...primaryNavigation.slice(3),
    // Scan still belongs somewhere in demo mode — it explains why it is off.
    ...(demoMode
      ? navigation.filter((item) => item.href === "/scan")
      : []),
    ...availableSecondaryNavigation,
  ];

  return (
    <div className="flex min-h-screen flex-col" data-oid="zfaufj9">
      <PreferenceHydrator data-oid="b9x-5v1" />
      <CatalogDownloadPrompt />
      <header
        className="fixed inset-x-0 top-0 z-40 border-b bg-background/90 backdrop-blur"
        data-oid="4h6rq90"
      >
        <div
          className="container flex h-16 items-center justify-between gap-4"
          data-oid="2j-vv-i"
        >
          <div className="flex min-w-0 items-center gap-6" data-oid="8gzdp.f">
            <Link
              href={dashboardHref}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap text-lg font-heading font-semibold"
              data-oid="vv0.7_x"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="TCGer logo"
                width={32}
                height={32}
                className="dark:invert"
                data-oid=".i3qz._"
              />
              TCGer
            </Link>
            {demoMode && (
              <Badge
                variant="secondary"
                className="hidden shrink-0 text-xs xl:inline-flex"
                data-oid="nve3vfa"
              >
                Demo Mode
              </Badge>
            )}
            <nav
              className="hidden items-center gap-1 md:flex"
              data-oid="bq6jx8."
            >
              {primaryNavigation.map((item) => {
                const href = getAppRoute(item.href, pathname);
                const isActive = pathname === href;
                const Icon = item.icon;
                return (
                  <Button
                    key={item.href}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    asChild
                    className={cn(
                      "min-[1360px]:px-3",
                      isActive && "bg-primary text-primary-foreground",
                    )}
                    data-oid="798:9uu"
                  >
                    <Link
                      href={href}
                      className="flex items-center gap-2"
                      title={item.label}
                      data-oid="uqcdkap"
                    >
                      <Icon className="h-4 w-4" data-oid="-fddsij" />
                      <span
                        className="hidden min-[1360px]:inline"
                        data-oid="lkg_0_o"
                      >
                        {item.label}
                      </span>
                    </Link>
                  </Button>
                );
              })}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2" data-oid="3834h_j">
            <CommandMenu
              secondaryNavigation={availableSecondaryNavigation}
              data-oid="i6m6x59"
            />
            <GameSwitcher data-oid="98z96r_" />
            <UserMenu data-oid="d8c.j:4" />
          </div>
        </div>
      </header>
      <main
        className="flex-1 bg-muted/20 pt-20 pb-16 md:pb-0"
        data-oid="qz_1-v1"
      >
        <div className="container space-y-6 py-8" data-oid="1zq._:c">
          {children}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <MobileBottomNav
        pathname={pathname}
        primaryNavigation={mobileNavPrimary}
        secondaryNavigation={mobileNavSecondary}
        data-oid="caik0xj"
      />
    </div>
  );
}

function MobileBottomNav({
  pathname,
  primaryNavigation,
  secondaryNavigation,
}: {
  pathname: string;
  primaryNavigation: NavigationItem[];
  secondaryNavigation: NavigationItem[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isSecondaryActive = secondaryNavigation.some(
    (item) => pathname === getAppRoute(item.href, pathname),
  );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur md:hidden"
        data-oid="t9mmwfu"
      >
        <div
          className="flex h-14 items-center justify-around"
          data-oid="gfppu0m"
        >
          {primaryNavigation.map((item) => {
            const href = getAppRoute(item.href, pathname);
            const isActive = pathname === href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors",
                  isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground",
                )}
                data-oid="hpx886w"
              >
                <Icon
                  className={cn("h-5 w-5", isActive && "text-primary")}
                  data-oid="r2kr0-3"
                />
                <span data-oid="i47bowi">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors",
              isSecondaryActive || moreOpen
                ? "text-primary font-medium"
                : "text-muted-foreground",
            )}
            data-oid="jcj-2s0"
          >
            <MoreHorizontal
              className={cn(
                "h-5 w-5",
                (isSecondaryActive || moreOpen) && "text-primary",
              )}
              data-oid="1f4-88v"
            />
            <span data-oid="ll:smf-">More</span>
          </button>
        </div>
      </nav>

      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" data-oid="_ua63hb">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
            data-oid="uop:n17"
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-background pb-16 pt-4"
            data-oid="02dsthq"
          >
            <div
              className="flex items-center justify-between px-6 pb-3"
              data-oid="qk4iwj2"
            >
              <span
                className="text-sm font-medium text-muted-foreground"
                data-oid=".4ob_ns"
              >
                More
              </span>
              <button
                onClick={() => setMoreOpen(false)}
                className="text-muted-foreground"
                data-oid="0b788_p"
              >
                <X className="h-5 w-5" data-oid="6adcdlh" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4" data-oid="0868z5k">
              {secondaryNavigation.map((item) => {
                const href = getAppRoute(item.href, pathname);
                const isActive = pathname === href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl p-4 text-xs transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                    data-oid="z7lzxox"
                  >
                    <Icon
                      className={cn("h-6 w-6", isActive && "text-primary")}
                      data-oid="a99zp0q"
                    />
                    <span data-oid="nwb.sx9">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PreferenceHydrator() {
  const token = useAuthStore((state) => state.token);
  const updateStoredPreferences = useAuthStore(
    (state) => state.updateStoredPreferences,
  );
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
        console.error("Failed to refresh user preferences:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [token, updateStoredPreferences]);

  return null;
}
