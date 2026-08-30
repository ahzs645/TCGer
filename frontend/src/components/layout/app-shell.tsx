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
  ReceiptText,
  BookOpen,
  Bell,
  QrCode,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ServerFeatures } from "@tcg/api-types";

interface NavigationItem {
  href: string;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
  feature?: keyof ServerFeatures;
}

/** Extra pages accessible via Quick Actions (⌘K) and mobile "More" menu */
export const secondaryNavigation: NavigationItem[] = [
  {
    href: "/online-codes",
    label: "Code Vault",
    icon: QrCode,
    feature: "onlineCodes",
  },
  { href: "/pokedex", label: "Pokédex", icon: BookOpen },
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
  {
    href: "/transactions",
    label: "Transactions",
    icon: ReceiptText,
    feature: "finance",
  },
  { href: "/sealed", label: "Sealed", icon: Package, feature: "sealed" },
  {
    href: "/activity",
    label: "Activity",
    icon: Bell,
    feature: "notifications",
  },
];

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CatalogDownloadPrompt } from "@/components/catalog/catalog-download-prompt";
import { ServerStatusBanner } from "./server-status-banner";
import { getAppRoute } from "@/lib/app-routes";
import {
  areSealedProductsEnabled,
  SEALED_PRODUCTS_PREFERENCE_EVENT,
} from "@/lib/catalog/catalog-client";
import { cn } from "@/lib/utils";
import { getUserPreferences } from "@/lib/api/user-preferences";
import { isFeatureAvailable, useServerFeatures } from "@/lib/api/health";
import { useAuthStore } from "@/stores/auth";

import { CommandMenu } from "../navigation/command-menu";
import { GameSwitcher } from "../navigation/game-switcher";
import { UserMenu } from "../navigation/user-menu";

const navigation: NavigationItem[] = [
  { href: "/", label: "Dashboard", mobileLabel: "Home", icon: LayoutDashboard },
  { href: "/packs", label: "Open Packs", icon: PackageOpen },
  { href: "/cards", label: "Card Search", mobileLabel: "Search", icon: Search },
  { href: "/scan", label: "Scan", icon: Camera },
  {
    href: "/collections",
    label: "Collections",
    mobileLabel: "Collection",
    icon: Table,
  },
  { href: "/wishlists", label: "Wishlists", icon: Heart },
];

function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function primaryNavigationFor(): NavigationItem[] {
  return navigation;
}

interface AppShellProps {
  children: React.ReactNode;
  /**
   * Hands the page the whole area between the fixed header and the mobile tab
   * bar, with no container padding and no page scroll — for immersive stages
   * like pack opening, which own their own chrome.
   */
  fullBleed?: boolean;
}

export function AppShell({ children, fullBleed = false }: AppShellProps) {
  const pathname = usePathname();
  const dashboardHref = getAppRoute("/", pathname);
  const features = useServerFeatures();
  const [sealedProductsEnabled, setSealedProductsPreference] = useState(true);
  useEffect(() => {
    const refresh = () =>
      setSealedProductsPreference(areSealedProductsEnabled());
    refresh();
    window.addEventListener(SEALED_PRODUCTS_PREFERENCE_EVENT, refresh);
    return () =>
      window.removeEventListener(SEALED_PRODUCTS_PREFERENCE_EVENT, refresh);
  }, []);
  // Stable during SSR and hydration; the persisted demo flag is client-only.
  const demoMode = pathname === "/demo" || pathname.startsWith("/demo/");
  const availableSecondaryNavigation = [...secondaryNavigation].filter(
    (item) =>
      (item.href !== "/online-codes" || !demoMode) &&
      (item.href !== "/sealed" || sealedProductsEnabled) &&
      (demoMode || !item.feature || isFeatureAvailable(features, item.feature)),
  );
  const primaryNavigation = primaryNavigationFor();
  const mobilePrimaryHrefs = ["/", "/collections", "/cards"];
  const mobileNavPrimary = mobilePrimaryHrefs.flatMap((href) => {
    const item = primaryNavigation.find((candidate) => candidate.href === href);
    return item ? [item] : [];
  });
  const mobileNavSecondary = [
    ...primaryNavigation.filter(
      (item) => !mobilePrimaryHrefs.includes(item.href),
    ),
    ...availableSecondaryNavigation,
  ];
  const isDesktopSecondaryActive = availableSecondaryNavigation.some((item) =>
    isNavigationItemActive(pathname, getAppRoute(item.href, pathname)),
  );

  return (
    <div className="flex min-h-screen flex-col" data-oid="zfaufj9">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] flex -translate-y-24 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform coarse:min-h-11 focus:translate-y-0"
      >
        Skip to main content
      </a>
      <PreferenceHydrator data-oid="b9x-5v1" />
      <CatalogDownloadPrompt />
      <header
        className="fixed inset-x-0 top-0 z-40 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur"
        data-oid="4h6rq90"
      >
        {/*
         * The header is deliberately NOT inside `.container`. `.container` caps
         * at 1360px (tailwind.config.ts), which is narrower than the header row
         * needs once the nav shows labels — the nav used to overflow *underneath*
         * the right-hand cluster and make the More menu unclickable at every
         * width from 1360 up. Giving the header the full viewport, and only
         * expanding the labels where they demonstrably fit, removes the conflict
         * instead of re-tuning it.
         */}
        <div
          className="mx-auto flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6"
          data-oid="2j-vv-i"
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-6"
            data-oid="8gzdp.f"
          >
            <Link
              href={dashboardHref}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap font-heading text-lg font-semibold coarse:min-h-11"
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
            {/*
             * `min-w-0 overflow-hidden` is the structural guarantee: even if a
             * future item pushes the row past the available width, the nav
             * clips itself instead of painting over the controls to its right.
             */}
            <nav
              className="hidden min-w-0 items-center gap-1 overflow-hidden md:flex"
              aria-label="Primary navigation"
              data-oid="bq6jx8."
            >
              {primaryNavigation.map((item) => {
                const href = getAppRoute(item.href, pathname);
                const isActive = isNavigationItemActive(pathname, href);
                const Icon = item.icon;
                return (
                  <Button
                    key={item.href}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    asChild
                    className={cn(
                      "min-[1700px]:px-3",
                      isActive && "bg-primary text-primary-foreground",
                    )}
                    data-oid="798:9uu"
                  >
                    <Link
                      href={href}
                      className="flex items-center gap-2"
                      title={item.label}
                      aria-current={isActive ? "page" : undefined}
                      data-oid="uqcdkap"
                    >
                      <Icon className="h-4 w-4" data-oid="-fddsij" />
                      <span
                        className="hidden min-[1700px]:inline"
                        data-oid="lkg_0_o"
                      >
                        {item.label}
                      </span>
                    </Link>
                  </Button>
                );
              })}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={isDesktopSecondaryActive ? "default" : "ghost"}
                    size="sm"
                    className={cn(
                      "gap-2",
                      isDesktopSecondaryActive &&
                        "bg-primary text-primary-foreground",
                    )}
                    aria-current={isDesktopSecondaryActive ? "page" : undefined}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden min-[1700px]:inline">More</span>
                    <span className="sr-only min-[1700px]:hidden">
                      More sections
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {availableSecondaryNavigation.map((item) => {
                    const href = getAppRoute(item.href, pathname);
                    const active = isNavigationItemActive(pathname, href);
                    const Icon = item.icon;
                    return (
                      <DropdownMenuItem key={item.href} asChild>
                        <Link
                          href={href}
                          className="flex items-center gap-2"
                          aria-current={active ? "page" : undefined}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          {item.label}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2" data-oid="3834h_j">
            <CommandMenu
              primaryNavigation={primaryNavigation}
              secondaryNavigation={availableSecondaryNavigation}
              data-oid="i6m6x59"
            />
            <GameSwitcher data-oid="98z96r_" />
            <UserMenu data-oid="d8c.j:4" />
          </div>
        </div>
      </header>
      <main
        id="main-content"
        className={cn(
          "bg-muted/20",
          fullBleed
            ? "flex h-[100dvh] flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))] md:pb-0"
            : "flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[calc(5rem+env(safe-area-inset-top))] md:pb-0",
        )}
        tabIndex={-1}
        data-oid="qz_1-v1"
      >
        <ServerStatusBanner demoMode={demoMode} />
        {fullBleed ? (
          <div className="min-h-0 flex-1">{children}</div>
        ) : (
          <div className="container space-y-6 py-6 md:py-8" data-oid="1zq._:c">
            {children}
          </div>
        )}
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
  const isSecondaryActive = secondaryNavigation.some((item) =>
    isNavigationItemActive(pathname, getAppRoute(item.href, pathname)),
  );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Primary navigation"
        data-oid="t9mmwfu"
      >
        <div
          className="flex h-16 items-center justify-around"
          data-oid="gfppu0m"
        >
          {primaryNavigation.map((item) => {
            const href = getAppRoute(item.href, pathname);
            const isActive = isNavigationItemActive(pathname, href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  "flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-xs transition-colors",
                  isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
                data-oid="hpx886w"
              >
                <Icon
                  className={cn("h-5 w-5", isActive && "text-primary")}
                  data-oid="r2kr0-3"
                />
                <span
                  className="whitespace-nowrap text-[10px] min-[360px]:text-xs"
                  data-oid="i47bowi"
                >
                  {item.mobileLabel ?? item.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(!moreOpen)}
            className={cn(
              "flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isSecondaryActive || moreOpen
                ? "text-primary font-medium"
                : "text-muted-foreground",
            )}
            aria-expanded={moreOpen}
            aria-controls="mobile-more-menu"
            aria-current={isSecondaryActive ? "page" : undefined}
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

      <Drawer
        open={moreOpen}
        onOpenChange={setMoreOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent
          id="mobile-more-menu"
          className="pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
          data-oid="02dsthq"
        >
          <DrawerHeader className="flex-row items-center justify-between px-6 pb-3 text-left">
            <div>
              <DrawerTitle>More</DrawerTitle>
              <DrawerDescription className="sr-only">
                Additional sections of TCGer
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close more menu"
                data-oid="0b788_p"
              >
                <X className="h-5 w-5" aria-hidden="true" data-oid="6adcdlh" />
              </button>
            </DrawerClose>
          </DrawerHeader>
          <div
            className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto px-4 pb-2"
            data-oid="0868z5k"
          >
            {secondaryNavigation.map((item) => {
              const href = getAppRoute(item.href, pathname);
              const isActive = isNavigationItemActive(pathname, href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={isActive ? "page" : undefined}
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
        </DrawerContent>
      </Drawer>
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
