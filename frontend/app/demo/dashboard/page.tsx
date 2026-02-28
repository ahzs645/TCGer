'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Coins,
  Heart,
  LayoutDashboard,
  Library,
  LogOut,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Table,
  Trash,
  User,
  X
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { searchDemoCards, getGameLabel, type DemoCard, type DemoTcg } from '@/lib/data/demo-cards';
import { useDemoStore } from '@/stores/demo-store';

/* ------------------------------------------------------------------ */
/*  Navigation                                                          */
/* ------------------------------------------------------------------ */

type DemoTab = 'dashboard' | 'cards' | 'collections' | 'wishlists';

const NAV_ITEMS: Array<{ key: DemoTab; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'cards', label: 'Card Search', icon: Search },
  { key: 'collections', label: 'Collections', icon: Table },
  { key: 'wishlists', label: 'Wishlists', icon: Heart }
];

/* ------------------------------------------------------------------ */
/*  Main page                                                           */
/* ------------------------------------------------------------------ */

export default function DemoDashboardPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>('dashboard');
  const [profileOpen, setProfileOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  const init = useDemoStore((s) => s.init);
  const profile = useDemoStore((s) => s.profile);
  const updateProfile = useDemoStore((s) => s.updateProfile);
  const resetDemo = useDemoStore((s) => s.resetDemo);

  useEffect(() => { init(); }, [init]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---- Header ---- */}
      <header className="fixed inset-x-0 top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/demo" className="flex items-center gap-2 text-lg font-heading font-semibold">
              <Image src="/logo.svg" alt="TCGer logo" width={32} height={32} className="h-8 w-8 dark:invert" />
              TCGer
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV_ITEMS.map((item) => {
                const isActive = activeTab === item.key;
                const Icon = item.icon;
                return (
                  <Button
                    key={item.key}
                    variant={isActive ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(isActive && 'bg-primary text-primary-foreground')}
                    onClick={() => setActiveTab(item.key)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </Button>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden sm:inline-flex">Demo Mode</Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
            </Button>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted/60 active:bg-muted"
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="hidden sm:inline">{profile.email}</span>
            </button>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/demo" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ---- Mobile bottom nav ---- */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur md:hidden">
        <div className="flex justify-around py-2">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md px-3 py-1.5 text-xs transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Profile dialog ---- */}
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        profile={profile}
        onUpdate={updateProfile}
        onReset={resetDemo}
      />

      {/* ---- Main content ---- */}
      <main className="flex-1 bg-muted/20 pb-20 pt-20 md:pb-8 md:pt-20">
        <div className="container space-y-4 py-4 md:space-y-6 md:py-8">
          {activeTab === 'dashboard' && <DemoDashboard />}
          {activeTab === 'cards' && <DemoCardSearch />}
          {activeTab === 'collections' && <DemoCollections />}
          {activeTab === 'wishlists' && <DemoWishlists />}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile dialog                                                      */
/* ------------------------------------------------------------------ */

function ProfileDialog({
  open,
  onOpenChange,
  profile,
  onUpdate,
  onReset
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: { username: string; email: string };
  onUpdate: (data: Partial<{ username: string; email: string }>) => void;
  onReset: () => void;
}) {
  const [editUsername, setEditUsername] = useState(profile.username);
  const [editing, setEditing] = useState(false);
  const binders = useDemoStore((s) => s.binders);
  const totalCards = binders.reduce((sum, b) => sum + b.cards.reduce((s, c) => s + c.quantity, 0), 0);
  const games = new Set(binders.flatMap((b) => b.cards.map((c) => c.tcg)));

  useEffect(() => {
    setEditUsername(profile.username);
  }, [profile.username, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 bg-muted">
              <User className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="flex gap-2">
                  <Input
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onUpdate({ username: editUsername.trim() || 'Demo User' });
                      setEditing(false);
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-left"
                >
                  <p className="font-semibold hover:underline">{profile.username}</p>
                  <p className="text-xs text-muted-foreground">Click to edit username</p>
                </button>
              )}
              <p className="text-sm text-muted-foreground">{profile.email}</p>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total cards</span>
              <span>{totalCards.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active games</span>
              <span>{games.size}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Binders</span>
              <span>{binders.length}</span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              onReset();
              onOpenChange(false);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset demo data
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Data is saved locally in your browser.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard tab                                                       */
/* ------------------------------------------------------------------ */

function DemoDashboard() {
  const binders = useDemoStore((s) => s.binders);

  const stats = useMemo(() => {
    let totalCards = 0;
    let totalValue = 0;
    const gameSet = new Set<string>();
    const recent: Array<{ id: string; name: string; tcg: string; binder: string; date: string }> = [];

    for (const binder of binders) {
      for (const card of binder.cards) {
        totalCards += card.quantity;
        totalValue += card.price * card.quantity;
        gameSet.add(card.tcg);
        recent.push({
          id: card.id,
          name: card.name,
          tcg: getGameLabel(card.tcg),
          binder: binder.name,
          date: new Date(card.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        });
      }
    }

    recent.sort((a, b) => b.id.localeCompare(a.id));

    const byGame: Record<string, number> = { yugioh: 0, magic: 0, pokemon: 0 };
    for (const binder of binders) {
      for (const card of binder.cards) {
        byGame[card.tcg] = (byGame[card.tcg] ?? 0) + card.quantity;
      }
    }

    const total = totalCards || 1;
    const games = [
      { name: 'Yu-Gi-Oh!', copies: byGame.yugioh, pct: Math.round((byGame.yugioh / total) * 100) },
      { name: 'Magic: The Gathering', copies: byGame.magic, pct: Math.round((byGame.magic / total) * 100) },
      { name: 'Pok\u00e9mon', copies: byGame.pokemon, pct: Math.round((byGame.pokemon / total) * 100) }
    ];

    return { totalCards, totalValue, activeGames: gameSet.size, recent: recent.slice(0, 5), games };
  }, [binders]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <StatCard title="Total Cards" value={stats.totalCards.toLocaleString()} description="Across all tracked TCGs" icon={<Library className="h-5 w-5" />} />
        <StatCard title="Estimated Value" value={`$${stats.totalValue.toFixed(2)}`} description="Based on collection pricing" icon={<Coins className="h-5 w-5" />} />
        <StatCard title="Active Games" value={stats.activeGames} description="Games with cards in your library" icon={<Sparkles className="h-5 w-5" />} />
        <StatCard title="Recent Additions" value={`${stats.recent.length} cards`} description="Latest cards you've logged" icon={<ArrowUpRight className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-xl">Card Distribution</CardTitle>
          <CardDescription>Your collection by trading card game.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <div className="grid gap-3 md:gap-4 md:grid-cols-3">
            {stats.games.map((game) => (
              <div key={game.name} className="space-y-1.5 rounded-lg border bg-card p-3 md:space-y-2 md:p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{game.name}</span>
                  <span className="text-muted-foreground">{game.copies}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${game.pct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{game.pct}% of collection</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-xl">Recent Activity</CardTitle>
          <CardDescription>Latest updates across your binders.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <div className="space-y-2 md:space-y-4">
            {stats.recent.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No activity yet. Add cards to your binders to see activity here.</p>
            )}
            {stats.recent.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/50 hover:bg-muted/40 md:gap-4 md:p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-none truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.tcg} &bull; {item.binder}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{item.date}</time>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card Search tab                                                     */
/* ------------------------------------------------------------------ */

function DemoCardSearch() {
  const [query, setQuery] = useState('');
  const [gameTcg, setGameTcg] = useState<DemoTcg | 'all'>('all');
  const [addDialogCard, setAddDialogCard] = useState<DemoCard | null>(null);
  const [addBinderId, setAddBinderId] = useState('');

  const binders = useDemoStore((s) => s.binders);
  const addCardToBinder = useDemoStore((s) => s.addCardToBinder);

  const results = useMemo(() => {
    return searchDemoCards(query, gameTcg);
  }, [query, gameTcg]);

  const handleAddToBinder = () => {
    if (!addDialogCard || !addBinderId) return;
    addCardToBinder(addBinderId, addDialogCard);
    setAddDialogCard(null);
    setAddBinderId('');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading font-semibold md:text-3xl">Card Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Search across Yu-Gi-Oh!, Magic: The Gathering, and Pok&eacute;mon. Results come from the local demo card database.
        </p>
      </div>

      <Tabs value={gameTcg} onValueChange={(v) => setGameTcg(v as DemoTcg | 'all')}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all" className="text-xs sm:text-sm">All Games</TabsTrigger>
          <TabsTrigger value="yugioh" className="text-xs sm:text-sm">Yu-Gi-Oh!</TabsTrigger>
          <TabsTrigger value="magic" className="text-xs sm:text-sm">Magic</TabsTrigger>
          <TabsTrigger value="pokemon" className="text-xs sm:text-sm">Pok&eacute;mon</TabsTrigger>
        </TabsList>

        {/* Single shared content area - game filter applied via state */}
        <TabsContent value={gameTcg} className="space-y-3 md:space-y-4" forceMount>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search for a card name, set, or rarity..."
              className="w-full pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {!query.trim() && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center md:py-16">
                <Search className="mb-3 h-8 w-8 text-muted-foreground/40 md:mb-4 md:h-12 md:w-12" />
                <p className="text-base font-medium text-muted-foreground md:text-lg">Start typing to search</p>
                <p className="text-xs text-muted-foreground/80 md:text-sm">
                  Try &ldquo;Blue-Eyes&rdquo;, &ldquo;Lightning Bolt&rdquo;, or &ldquo;Charizard&rdquo;
                </p>
              </CardContent>
            </Card>
          )}

          {query.trim() && results.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center md:py-16">
                <X className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-base font-medium text-muted-foreground">No cards found</p>
                <p className="text-xs text-muted-foreground/80">Try a different search term.</p>
              </CardContent>
            </Card>
          )}

          {results.length > 0 && (
            <div className="grid gap-3 md:gap-4 md:grid-cols-2 xl:grid-cols-3">
              {results.map((card) => (
                <Card key={card.id} className="transition hover:border-primary/50 hover:shadow-md">
                  <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm md:text-base">{card.name}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 text-xs">{getGameLabel(card.tcg)}</Badge>
                    </div>
                    <CardDescription>{card.setCode} &bull; {card.setName}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <Badge variant="outline" className="text-xs mr-2">{card.rarity}</Badge>
                        <span className="font-semibold text-sm md:text-base">${card.price.toFixed(2)}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAddDialogCard(card);
                          setAddBinderId(binders[0]?.id ?? '');
                        }}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add-to-binder dialog */}
      <Dialog open={!!addDialogCard} onOpenChange={(o) => !o && setAddDialogCard(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Binder</DialogTitle>
            <DialogDescription>
              Add &ldquo;{addDialogCard?.name}&rdquo; to a binder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Binder</Label>
              <Select value={addBinderId} onValueChange={setAddBinderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select binder..." />
                </SelectTrigger>
                <SelectContent>
                  {binders.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddDialogCard(null)}>Cancel</Button>
            <Button onClick={handleAddToBinder} disabled={!addBinderId}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collections tab                                                     */
/* ------------------------------------------------------------------ */

function DemoCollections() {
  const binders = useDemoStore((s) => s.binders);
  const addBinder = useDemoStore((s) => s.addBinder);
  const removeBinder = useDemoStore((s) => s.removeBinder);
  const removeCardFromBinder = useDemoStore((s) => s.removeCardFromBinder);

  const [selectedBinder, setSelectedBinder] = useState<string | null>(null);
  const [newBinderDialogOpen, setNewBinderDialogOpen] = useState(false);
  const [newBinderName, setNewBinderName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const activeBinder = binders.find((b) => b.id === selectedBinder);

  const handleCreateBinder = () => {
    if (!newBinderName.trim()) return;
    const id = addBinder(newBinderName.trim());
    setSelectedBinder(id);
    setNewBinderName('');
    setNewBinderDialogOpen(false);
  };

  const handleDeleteBinder = (id: string) => {
    removeBinder(id);
    if (selectedBinder === id) setSelectedBinder(null);
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-heading font-semibold md:text-3xl">Collections</h1>
          <Badge variant="outline">Demo</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Per-copy inventory manager. Data is saved in your browser.</p>
      </div>

      {/* Mobile: binder dropdown */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Binder</h2>
          <Button variant="outline" size="sm" onClick={() => setNewBinderDialogOpen(true)}>+ New</Button>
        </div>
        <Select value={selectedBinder ?? ''} onValueChange={setSelectedBinder}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a binder..." />
          </SelectTrigger>
          <SelectContent>
            {binders.map((binder) => (
              <SelectItem key={binder.id} value={binder.id}>
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: binder.color }} />
                  {binder.name}
                  <span className="text-muted-foreground">&middot; {binder.cards.length}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Desktop: binder sidebar */}
        <div className="hidden lg:block space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Binders</h2>
            <Button variant="outline" size="sm" onClick={() => setNewBinderDialogOpen(true)}>+ New</Button>
          </div>
          <div className="space-y-1">
            {binders.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No binders yet. Create one to get started.</p>
            )}
            {binders.map((binder) => {
              const totalQty = binder.cards.reduce((s, c) => s + c.quantity, 0);
              return (
                <button
                  key={binder.id}
                  onClick={() => setSelectedBinder(binder.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition',
                    selectedBinder === binder.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/30 hover:bg-muted/40'
                  )}
                >
                  <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: binder.color }} />
                  <div className="flex-1 truncate">
                    <p className="font-medium truncate">{binder.name}</p>
                    <p className="text-xs text-muted-foreground">{totalQty} cards &bull; {binder.cards.length} unique</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content area */}
        <Card>
          {!activeBinder ? (
            <CardContent className="flex flex-col items-center justify-center py-12 text-center md:py-20">
              <Table className="mb-4 h-10 w-10 text-muted-foreground/40 md:h-12 md:w-12" />
              <p className="text-base font-medium text-muted-foreground md:text-lg">Select a binder</p>
              <p className="text-sm text-muted-foreground/80">Choose a binder to view and manage its cards.</p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="p-4 md:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: activeBinder.color }} />
                    <div className="min-w-0">
                      <CardTitle className="text-base md:text-xl truncate">{activeBinder.name}</CardTitle>
                      <CardDescription>
                        {activeBinder.cards.reduce((s, c) => s + c.quantity, 0)} cards &bull; ${activeBinder.cards.reduce((s, c) => s + c.price * c.quantity, 0).toFixed(2)} value
                      </CardDescription>
                    </div>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(activeBinder.id)}>
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                {activeBinder.cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Library className="mb-3 h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      This binder is empty. Use Card Search to add cards.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide md:grid-cols-[1fr_100px_80px_60px] md:gap-4 md:px-4 md:py-3">
                      <span>Card Name</span>
                      <span>Cond.</span>
                      <span className="text-right">Price</span>
                      <span></span>
                    </div>
                    {activeBinder.cards.map((card) => (
                      <div
                        key={card.id}
                        className="group grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/20 transition md:grid-cols-[1fr_100px_80px_60px] md:gap-4 md:px-4 md:py-3"
                      >
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{card.name}</span>
                          <span className="text-xs text-muted-foreground">{getGameLabel(card.tcg)} &bull; {card.quantity}x</span>
                        </div>
                        <Badge variant="secondary" className="w-fit text-xs">{card.condition.split(' ').map(w => w[0]).join('')}</Badge>
                        <span className="text-right">${card.price.toFixed(2)}</span>
                        <button
                          type="button"
                          onClick={() => removeCardFromBinder(activeBinder.id, card.id)}
                          className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition"
                          aria-label="Remove card"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* New binder dialog */}
      <Dialog open={newBinderDialogOpen} onOpenChange={setNewBinderDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Binder</DialogTitle>
            <DialogDescription>Create a new binder to organize your cards.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="binder-name">Name</Label>
              <Input
                id="binder-name"
                value={newBinderName}
                onChange={(e) => setNewBinderName(e.target.value)}
                placeholder="e.g., Trade Binder, Vintage Cards"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateBinder()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewBinderDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBinder} disabled={!newBinderName.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete binder confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Binder</DialogTitle>
            <DialogDescription>
              Are you sure? This will remove the binder and all its cards. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDeleteBinder(deleteConfirm)}>
              <Trash className="mr-1 h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wishlists tab                                                       */
/* ------------------------------------------------------------------ */

function DemoWishlists() {
  const wishlists = useDemoStore((s) => s.wishlists);
  const binders = useDemoStore((s) => s.binders);
  const addWishlistFn = useDemoStore((s) => s.addWishlist);
  const removeWishlistFn = useDemoStore((s) => s.removeWishlist);
  const addCardToWishlistFn = useDemoStore((s) => s.addCardToWishlist);
  const removeCardFromWishlistFn = useDemoStore((s) => s.removeCardFromWishlist);

  const [activeWishlistId, setActiveWishlistId] = useState<string | null>(null);
  const [filterOwned, setFilterOwned] = useState<'all' | 'owned' | 'missing'>('all');
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [addCardDialogOpen, setAddCardDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const activeWishlist = wishlists.find((w) => w.id === activeWishlistId);

  // Build an index of all cards owned in any binder
  const ownedCardIds = useMemo(() => {
    const map = new Map<string, number>();
    for (const binder of binders) {
      for (const card of binder.cards) {
        map.set(card.cardId, (map.get(card.cardId) ?? 0) + card.quantity);
      }
    }
    return map;
  }, [binders]);

  const enrichedCards = useMemo(() => {
    if (!activeWishlist) return [];
    return activeWishlist.cards.map((c) => ({
      ...c,
      owned: ownedCardIds.has(c.cardId),
      ownedQty: ownedCardIds.get(c.cardId) ?? 0
    }));
  }, [activeWishlist, ownedCardIds]);

  const filteredCards = useMemo(() => {
    return enrichedCards.filter((c) => {
      if (filterOwned === 'owned') return c.owned;
      if (filterOwned === 'missing') return !c.owned;
      return true;
    });
  }, [enrichedCards, filterOwned]);

  const ownedCount = enrichedCards.filter((c) => c.owned).length;
  const totalCount = enrichedCards.length;
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;

  const handleCreate = () => {
    if (!newName.trim()) return;
    const id = addWishlistFn(newName.trim(), newDesc.trim() || undefined);
    setActiveWishlistId(id);
    setNewName('');
    setNewDesc('');
    setNewDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    removeWishlistFn(id);
    if (activeWishlistId === id) setActiveWishlistId(null);
    setDeleteConfirm(null);
  };

  const searchResults = useMemo(() => {
    return searchDemoCards(searchQuery);
  }, [searchQuery]);

  // ── Detail view ──
  if (activeWishlist) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setActiveWishlistId(null); setFilterOwned('all'); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-heading font-semibold md:text-3xl truncate">{activeWishlist.name}</h1>
            <p className="text-sm text-muted-foreground">
              {ownedCount} / {totalCount} owned &bull; {pct}% complete
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { setAddCardDialogOpen(true); setSearchQuery(''); }}>
              <Plus className="mr-1 h-4 w-4" /> Add Cards
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(activeWishlist.id)}>
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="h-2 w-full max-w-xs rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex gap-2">
          <Select value={filterOwned} onValueChange={(v) => setFilterOwned(v as 'all' | 'owned' | 'missing')}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cards</SelectItem>
              <SelectItem value="owned">Owned</SelectItem>
              <SelectItem value="missing">Missing</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredCards.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Heart className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {totalCount === 0 ? 'This wishlist is empty. Add cards to start tracking.' : 'No cards match your filter.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredCards.map((card) => (
              <div
                key={card.id}
                className={cn(
                  'group relative rounded-lg border p-3 transition',
                  card.owned
                    ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30'
                    : 'border-input bg-card'
                )}
              >
                <button
                  type="button"
                  onClick={() => removeCardFromWishlistFn(activeWishlist.id, card.id)}
                  className="absolute right-2 top-2 rounded-full p-1 opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Remove from wishlist"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex h-[56px] w-[40px] shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground',
                      !card.owned && 'opacity-50'
                    )}
                  >
                    {card.owned ? <Check className="h-5 w-5 text-emerald-500" /> : <X className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-tight truncate">{card.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{card.setCode} &bull; {card.setName}</p>
                    <Badge variant="outline" className="mt-1 text-[9px] h-4">{card.rarity}</Badge>
                    <div className="mt-1">
                      {card.owned ? (
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          Owned ({card.ownedQty}x)
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-muted-foreground">Not owned</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add card to wishlist dialog */}
        <Dialog open={addCardDialogOpen} onOpenChange={setAddCardDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Cards to Wishlist</DialogTitle>
              <DialogDescription>Search for cards to add to &ldquo;{activeWishlist.name}&rdquo;.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by card name..."
              />
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {searchResults.length === 0 && searchQuery.trim() && (
                  <p className="py-4 text-center text-sm text-muted-foreground">No cards found.</p>
                )}
                {!searchQuery.trim() && (
                  <p className="py-4 text-center text-sm text-muted-foreground">Type to search the card database.</p>
                )}
                {searchResults.map((card) => {
                  const alreadyAdded = activeWishlist.cards.some((c) => c.cardId === card.id);
                  return (
                    <div key={card.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{card.name}</p>
                        <p className="text-xs text-muted-foreground">{card.setName} &bull; {getGameLabel(card.tcg)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyAdded ? 'secondary' : 'default'}
                        onClick={() => !alreadyAdded && addCardToWishlistFn(activeWishlist.id, card)}
                        disabled={alreadyAdded}
                      >
                        {alreadyAdded ? <><Check className="mr-1 h-3 w-3" /> Added</> : <><Plus className="mr-1 h-3 w-3" /> Add</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddCardDialogOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Wishlist</DialogTitle>
              <DialogDescription>Are you sure? This can&apos;t be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
                <Trash className="mr-1 h-4 w-4" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-semibold md:text-3xl">Wishlists</h1>
          <p className="text-sm text-muted-foreground">Track cards you&apos;re looking to acquire.</p>
        </div>
        <Button onClick={() => setNewDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {wishlists.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Heart className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No wishlists yet. Create one to start tracking cards.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {wishlists.map((list) => {
          const owned = list.cards.filter((c) => ownedCardIds.has(c.cardId)).length;
          const total = list.cards.length;
          const pctVal = total > 0 ? Math.round((owned / total) * 100) : 0;
          return (
            <Card
              key={list.id}
              className="cursor-pointer transition hover:border-primary/50 hover:shadow-md active:scale-[0.98]"
              onClick={() => setActiveWishlistId(list.id)}
            >
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="text-sm md:text-base">{list.name}</CardTitle>
                <CardDescription>{total} cards &bull; {pctVal}% complete</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-all', pctVal === 100 ? 'bg-emerald-500' : 'bg-primary')}
                      style={{ width: `${pctVal}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{owned} of {total} acquired</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create wishlist dialog */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Wishlist</DialogTitle>
            <DialogDescription>Create a new wishlist to track cards you want.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="wl-name">Name</Label>
              <Input
                id="wl-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Every Darkrai, Eevee Collection"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-desc">Description (optional)</Label>
              <Input
                id="wl-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What are you collecting?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat card helper                                                    */
/* ------------------------------------------------------------------ */

function StatCard({ title, value, description, icon }: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs font-medium text-muted-foreground md:text-sm">{title}</CardTitle>
        <span className="text-muted-foreground hidden sm:inline">{icon}</span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className="text-xl font-semibold tracking-tight md:text-3xl">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground md:mt-2 md:text-sm">{description}</p>
      </CardContent>
    </Card>
  );
}
