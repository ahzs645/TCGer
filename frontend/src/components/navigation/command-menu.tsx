'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Calculator, Heart, LayoutDashboard, Search, Table } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { cn, GAME_LABELS } from '@/lib/utils';
import { supportedGameOptions, useGameFilterStore } from '@/stores/game-filter';

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { selectedGame, setGame } = useGameFilterStore((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame
  }));

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const handleNavigate = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  const quickCalculations = [
    { label: 'View price analytics (coming soon)', icon: Calculator }
  ];

  return (
    <>
      <Button
        variant="outline"
        className="items-center gap-2 text-sm text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Quick Actions</span>
        <kbd className="pointer-events-none hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to page, change TCG, or trigger an action..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => handleNavigate('/')}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
              <CommandShortcut>G D</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigate('/cards')}>
              <Search className="mr-2 h-4 w-4" />
              Card Search
              <CommandShortcut>G C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigate('/collections')}>
              <Table className="mr-2 h-4 w-4" />
              Collections
              <CommandShortcut>G L</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigate('/wishlists')}>
              <Heart className="mr-2 h-4 w-4" />
              Wishlists
              <CommandShortcut>G W</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Switch TCG">
            {supportedGameOptions.map((option) => (
              <CommandItem
                key={option.value}
                onSelect={() => {
                  setGame(option.value);
                  setOpen(false);
                }}
                className={cn(selectedGame === option.value && 'aria-selected:bg-accent')}
              >
                <span className="mr-2 h-2 w-2 rounded-full bg-primary" />
                {GAME_LABELS[option.value]}
                {selectedGame === option.value && <CommandShortcut>Current</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Utilities">
            {quickCalculations.map((item) => (
              <CommandItem key={item.label} onSelect={() => setOpen(false)}>
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
