"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Calculator,
  Camera,
  Heart,
  LayoutDashboard,
  Search,
  Table,
} from "lucide-react";
import { secondaryNavigation } from "@/components/layout/app-shell";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { getAppRoute } from "@/lib/app-routes";
import { cn, GAME_LABELS } from "@/lib/utils";
import { supportedGameOptions, useGameFilterStore } from "@/stores/game-filter";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { selectedGame, setGame } = useGameFilterStore((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame,
  }));

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const handleNavigate = (path: string) => {
    setOpen(false);
    router.push(getAppRoute(path, pathname));
  };

  const quickCalculations = [
    { label: "View price analytics (coming soon)", icon: Calculator },
  ];

  return (
    <>
      <Button
        variant="outline"
        className="items-center gap-2 text-sm text-muted-foreground"
        onClick={() => setOpen(true)}
        data-oid="v61e9fn"
      >
        <Search className="h-4 w-4" data-oid=":8kbdel" />
        <span className="hidden sm:inline" data-oid="8xyec9b">
          Quick Actions
        </span>
        <kbd
          className="pointer-events-none hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex"
          data-oid="9gg10m9"
        >
          <span className="text-xs" data-oid="xi8-6.d">
            ⌘
          </span>
          K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} data-oid="kav-n7p">
        <CommandInput
          placeholder="Jump to page, change TCG, or trigger an action..."
          data-oid="u0slqf8"
        />
        <CommandList data-oid="zd2rt9:">
          <CommandEmpty data-oid="zsto0ak">No results found.</CommandEmpty>
          <CommandGroup heading="Navigation" data-oid="z6o4cws">
            <CommandItem
              onSelect={() => handleNavigate("/")}
              data-oid="ehzpm21"
            >
              <LayoutDashboard className="mr-2 h-4 w-4" data-oid="i:qe8qx" />
              Dashboard
              <CommandShortcut data-oid="eit846e">G D</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => handleNavigate("/cards")}
              data-oid="ri6-_rt"
            >
              <Search className="mr-2 h-4 w-4" data-oid="ms58nkv" />
              Card Search
              <CommandShortcut data-oid="qkvae.x">G C</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => handleNavigate("/scan")}
              data-oid="0fjw32m"
            >
              <Camera className="mr-2 h-4 w-4" data-oid="pvvjix9" />
              Card Scan
              <CommandShortcut data-oid="3ct3-e0">G S</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => handleNavigate("/collections")}
              data-oid="aj2pvdv"
            >
              <Table className="mr-2 h-4 w-4" data-oid="h9q6j_g" />
              Collections
              <CommandShortcut data-oid="i4bgrkm">G L</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => handleNavigate("/wishlists")}
              data-oid="9-e.9bo"
            >
              <Heart className="mr-2 h-4 w-4" data-oid="tc7wp2." />
              Wishlists
              <CommandShortcut data-oid="garf36s">G W</CommandShortcut>
            </CommandItem>
            {secondaryNavigation.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  onSelect={() => handleNavigate(item.href)}
                  data-oid="nq:mkic"
                >
                  <Icon className="mr-2 h-4 w-4" data-oid="j4o4kiw" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandSeparator data-oid="9c424pr" />
          <CommandGroup heading="Switch TCG" data-oid="93ylv0g">
            {supportedGameOptions.map((option) => (
              <CommandItem
                key={option.value}
                onSelect={() => {
                  setGame(option.value);
                  setOpen(false);
                }}
                className={cn(
                  selectedGame === option.value && "aria-selected:bg-accent",
                )}
                data-oid="90pt_3y"
              >
                <span
                  className="mr-2 h-2 w-2 rounded-full bg-primary"
                  data-oid="n5_srws"
                />
                {GAME_LABELS[option.value]}
                {selectedGame === option.value && (
                  <CommandShortcut data-oid="b:1rcww">Current</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator data-oid="8tzqeph" />
          <CommandGroup heading="Utilities" data-oid=":l2ys-2">
            {quickCalculations.map((item) => (
              <CommandItem
                key={item.label}
                onSelect={() => setOpen(false)}
                data-oid="n-u4meb"
              >
                <item.icon className="mr-2 h-4 w-4" data-oid="1omz2kt" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
