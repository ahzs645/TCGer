"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { getAppRoute } from "@/lib/app-routes";
import { cn, GAME_LABELS } from "@/lib/utils";
import { supportedGameOptions, useGameFilterStore } from "@/stores/game-filter";

import { useShallow } from "zustand/react/shallow";
interface CommandMenuNavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface CommandMenuProps {
  /**
   * Both lists come from AppShell so the palette can never advertise a
   * destination the shell has filtered out — it used to hardcode its own copy
   * of the primary nav, which still offered Card Scan in demo mode after the
   * shell stopped doing so.
   */
  primaryNavigation: CommandMenuNavigationItem[];
  secondaryNavigation: CommandMenuNavigationItem[];
}

export function CommandMenu({
  primaryNavigation,
  secondaryNavigation,
}: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { selectedGame, setGame } = useGameFilterStore(
    useShallow((state) => ({
      selectedGame: state.selectedGame,
      setGame: state.setGame,
    })),
  );

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

  return (
    <>
      <Button
        variant="outline"
        className="items-center gap-2 text-sm text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Quick actions"
        title="Quick actions (⌘K)"
        data-oid="v61e9fn"
      >
        <Search className="h-4 w-4" data-oid=":8kbdel" />
        <span className="hidden lg:inline" data-oid="8xyec9b">
          Quick Actions
        </span>
        <kbd
          className="pointer-events-none hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline-flex"
          data-oid="9gg10m9"
        >
          <span className="text-xs" data-oid="xi8-6.d">
            ⌘
          </span>
          K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} data-oid="kav-n7p">
        <CommandList data-oid="zd2rt9:">
          <CommandEmpty data-oid="zsto0ak">No results found.</CommandEmpty>
          <CommandGroup heading="Navigation" data-oid="z6o4cws">
            {[...primaryNavigation, ...secondaryNavigation].map((item) => {
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
        </CommandList>
      </CommandDialog>
    </>
  );
}
