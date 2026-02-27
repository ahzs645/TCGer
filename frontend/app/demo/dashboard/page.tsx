'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Coins,
  Heart,
  LayoutDashboard,
  Library,
  LogOut,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  Table,
  Trash2,
  User
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useDemoStore } from '@/lib/hooks/use-demo-store';

/* ------------------------------------------------------------------ */
/*  Mock search results (search isn't persisted — always static)        */
/* ------------------------------------------------------------------ */

const MOCK_SEARCH_RESULTS = [
  { name: 'Blue-Eyes White Dragon', set: 'LOB-001', tcg: 'Yu-Gi-Oh!', price: '$24.99' },
  { name: 'Dark Magician', set: 'SDY-006', tcg: 'Yu-Gi-Oh!', price: '$12.50' },
  { name: 'Exodia the Forbidden One', set: 'LOB-124', tcg: 'Yu-Gi-Oh!', price: '$38.00' }
];

/* ------------------------------------------------------------------ */
/*  Navigation items                                                    */
/* ------------------------------------------------------------------ */

type DemoTab = 'dashboard' | 'cards' | 'collections' | 'wishlists';

const NAV_ITEMS: Array<{ key: DemoTab; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'cards', label: 'Card Search', icon: Search },
  { key: 'collections', label: 'Collections', icon: Table },
  { key: 'wishlists', label: 'Wishlists', icon: Heart }
];

const BINDER_COLORS = [
  '#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#6366f1',
  '#ec4899', '#14b8a6', '#f97316', '#64748b'
];

const GAME_OPTIONS = ['Yu-Gi-Oh!', 'Magic', 'Pokémon'];

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function DemoDashboardPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>('dashboard');
  const [selectedBinder, setSelectedBinder] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const store = useDemoStore();

  const navigateToBinder = (binderId: string) => {
    setSelectedBinder(binderId);
    setActiveTab('collections');
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---- Header (mirrors AppShell) ---- */}
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

            {/* Profile — desktop: static, mobile: toggle dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted/40"
              >
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="hidden sm:inline">demo@tcger.app</span>
              </button>

              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-background p-2 shadow-lg">
                    <div className="px-3 py-2 text-sm">
                      <p className="font-medium">Demo User</p>
                      <p className="text-xs text-muted-foreground">demo@tcger.app</p>
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={() => { store.resetDemo(); setProfileOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                      Reset demo data
                    </button>
                    <Link
                      href="/demo"
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
                      onClick={() => setProfileOpen(false)}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </Link>
                  </div>
                </>
              )}
            </div>

            <Button variant="ghost" size="icon" asChild className="hidden sm:inline-flex">
              <Link href="/demo" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ---- Mobile nav ---- */}
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

      {/* ---- Main content ---- */}
      <main className="flex-1 bg-muted/20 pb-20 pt-16 md:pb-8 md:pt-20">
        <div className="container space-y-4 py-4 md:space-y-6 md:py-8">
          {activeTab === 'dashboard' && (
            <DemoDashboard store={store} onNavigateToBinder={navigateToBinder} />
          )}
          {activeTab === 'cards' && <DemoCardSearch />}
          {activeTab === 'collections' && (
            <DemoCollections
              store={store}
              selectedBinder={selectedBinder}
              onSelectBinder={setSelectedBinder}
            />
          )}
          {activeTab === 'wishlists' && <DemoWishlists store={store} />}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard tab                                                       */
/* ------------------------------------------------------------------ */

function DemoDashboard({
  store,
  onNavigateToBinder
}: {
  store: ReturnType<typeof useDemoStore>;
  onNavigateToBinder: (binderId: string) => void;
}) {
  const estimatedValue = store.binders.reduce(
    (sum, b) => sum + b.cards.reduce((s, c) => s + parseFloat(c.price.replace('$', '') || '0'), 0),
    0
  );
  const activeGames = new Set(store.binders.filter((b) => b.cards.length > 0).map((b) => b.game)).size;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <StatCard
          title="Total Cards"
          value={store.totalCards.toLocaleString()}
          description="Across all tracked TCGs"
          icon={<Library className="h-5 w-5" />}
        />
        <StatCard
          title="Estimated Value"
          value={`$${estimatedValue.toFixed(2)}`}
          description="Based on collection pricing"
          icon={<Coins className="h-5 w-5" />}
        />
        <StatCard
          title="Active Games"
          value={activeGames}
          description="Games with cards in your library"
          icon={<Sparkles className="h-5 w-5" />}
        />
        <StatCard
          title="Recent Additions"
          value={`${store.recentActivity.length} cards`}
          description="Latest cards you've logged"
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
      </div>

      {/* Game breakdown */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-xl">Card Distribution</CardTitle>
          <CardDescription>Your collection by trading card game.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          {store.games.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add cards to a binder to see your distribution.</p>
          ) : (
            <div className="grid gap-3 md:gap-4 md:grid-cols-3">
              {store.games.map((game) => (
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
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-xl">Recent Activity</CardTitle>
          <CardDescription>Latest updates across your binders.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <div className="space-y-2 md:space-y-4">
            {store.recentActivity.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
            {store.recentActivity.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigateToBinder(item.binderId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-muted/40 md:gap-4 md:p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-none truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.tcg} &bull; {item.binder}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <time className="text-xs text-muted-foreground">{item.date}</time>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
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
  const showResults = query.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading font-semibold md:text-3xl">Card Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Search across Yu-Gi-Oh!, Magic: The Gathering, and Pok&eacute;mon using the unified adapter layer.
        </p>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all" className="text-xs sm:text-sm">All Games</TabsTrigger>
          <TabsTrigger value="yugioh" className="text-xs sm:text-sm">Yu-Gi-Oh!</TabsTrigger>
          <TabsTrigger value="magic" className="text-xs sm:text-sm">Magic</TabsTrigger>
          <TabsTrigger value="pokemon" className="text-xs sm:text-sm">Pok&eacute;mon</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3 md:space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search for a card name, set, or ID..."
              className="w-full pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {!showResults && (
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

          {showResults && (
            <div className="grid gap-3 md:gap-4 md:grid-cols-2 xl:grid-cols-3">
              {MOCK_SEARCH_RESULTS.map((card) => (
                <Card key={card.name} className="cursor-pointer transition hover:border-primary/50 hover:shadow-md">
                  <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm md:text-base">{card.name}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 text-xs">{card.tcg}</Badge>
                    </div>
                    <CardDescription>{card.set}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground md:text-sm">Market price</span>
                      <span className="font-semibold text-sm md:text-base">{card.price}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Other tabs show the same empty state */}
        {['yugioh', 'magic', 'pokemon'].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search for a card name, set, or ID..." className="w-full pl-10" disabled />
            </div>
            <Card className="mt-3 md:mt-4">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center md:py-16">
                <Search className="mb-3 h-8 w-8 text-muted-foreground/40 md:mb-4 md:h-12 md:w-12" />
                <p className="text-base font-medium text-muted-foreground md:text-lg">Start typing to search</p>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collections tab                                                     */
/* ------------------------------------------------------------------ */

function DemoCollections({
  store,
  selectedBinder,
  onSelectBinder
}: {
  store: ReturnType<typeof useDemoStore>;
  selectedBinder: string | null;
  onSelectBinder: (id: string | null) => void;
}) {
  const activeBinder = store.binders.find((b) => b.id === selectedBinder);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-heading font-semibold md:text-3xl">Collection sandbox</h1>
          <Badge variant="outline">Beta</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Per-copy inventory manager powered by your live binder data.</p>
      </div>

      {/* Mobile: binder dropdown */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Binder</h2>
          <NewBinderDialog store={store} />
        </div>
        <Select value={selectedBinder ?? ''} onValueChange={onSelectBinder}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a binder..." />
          </SelectTrigger>
          <SelectContent>
            {store.binders.map((binder) => (
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
            <NewBinderDialog store={store} />
          </div>
          <div className="space-y-1">
            {store.binders.map((binder) => (
              <button
                key={binder.id}
                onClick={() => onSelectBinder(binder.id)}
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
                  <p className="text-xs text-muted-foreground">{binder.game} &bull; {binder.cards.length} cards</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <Card>
          {!selectedBinder ? (
            <CardContent className="flex flex-col items-center justify-center py-12 text-center md:py-20">
              <Table className="mb-4 h-10 w-10 text-muted-foreground/40 md:h-12 md:w-12" />
              <p className="text-base font-medium text-muted-foreground md:text-lg">Select a binder</p>
              <p className="text-sm text-muted-foreground/80">
                Choose a binder to view and manage its cards.
              </p>
            </CardContent>
          ) : activeBinder ? (
            <>
              <CardHeader className="p-4 md:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: activeBinder.color }}
                    />
                    <div>
                      <CardTitle className="text-base md:text-xl">{activeBinder.name}</CardTitle>
                      <CardDescription>
                        {activeBinder.cards.length} cards &bull; {activeBinder.game}
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => { store.deleteBinder(activeBinder.id); onSelectBinder(null); }}
                    aria-label="Delete binder"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                {activeBinder.cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Library className="mb-3 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">This binder is empty.</p>
                    <p className="text-xs text-muted-foreground/80">Use Card Search to find and add cards.</p>
                  </div>
                ) : (
                  <div className="rounded-lg border">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide md:grid-cols-[1fr_100px_80px] md:gap-4 md:px-4 md:py-3">
                      <span>Card Name</span>
                      <span>Cond.</span>
                      <span className="text-right">Price</span>
                    </div>
                    {activeBinder.cards.map((card) => (
                      <div
                        key={card.id}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/20 transition md:grid-cols-[1fr_100px_80px] md:gap-4 md:px-4 md:py-3"
                      >
                        <span className="font-medium">{card.name}</span>
                        <Badge variant="secondary" className="w-fit text-xs">{card.condition}</Badge>
                        <span className="text-right">{card.price}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New Binder Dialog                                                   */
/* ------------------------------------------------------------------ */

function NewBinderDialog({ store }: { store: ReturnType<typeof useDemoStore> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(BINDER_COLORS[0]);
  const [game, setGame] = useState(GAME_OPTIONS[0]);

  const handleCreate = () => {
    if (!name.trim()) return;
    store.addBinder(name.trim(), color, game);
    setName('');
    setColor(BINDER_COLORS[0]);
    setGame(GAME_OPTIONS[0]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" />
          New
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create binder</DialogTitle>
          <DialogDescription>Add a new binder to organize your collection.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="binder-name">Name</Label>
            <Input
              id="binder-name"
              placeholder="e.g. Modern Staples"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
          <div className="space-y-2">
            <Label>Game</Label>
            <Select value={game} onValueChange={setGame}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAME_OPTIONS.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {BINDER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition',
                    color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                >
                  {color === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>Create binder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Wishlists tab                                                       */
/* ------------------------------------------------------------------ */

function DemoWishlists({ store }: { store: ReturnType<typeof useDemoStore> }) {
  const [selectedWishlist, setSelectedWishlist] = useState<string | null>(null);
  const active = store.wishlists.find((wl) => wl.id === selectedWishlist);

  if (active) {
    const completed = active.items.filter((i) => i.acquired).length;
    const pct = active.items.length > 0 ? Math.round((completed / active.items.length) * 100) : 0;

    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <button
            onClick={() => setSelectedWishlist(null)}
            className="mb-2 flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to wishlists
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-semibold md:text-3xl">{active.name}</h1>
              <p className="text-sm text-muted-foreground">
                {completed} of {active.items.length} acquired &bull; {pct}% complete
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => { store.deleteWishlist(active.id); setSelectedWishlist(null); }}
              aria-label="Delete wishlist"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {active.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Heart className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">This wishlist is empty.</p>
              </div>
            ) : (
              <div className="divide-y">
                {active.items.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-muted/20"
                  >
                    <Checkbox
                      checked={item.acquired}
                      onCheckedChange={() => store.toggleWishlistItem(active.id, item.id)}
                      className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        'text-sm font-medium truncate',
                        item.acquired && 'line-through text-muted-foreground'
                      )}>
                        {item.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.tcg}</p>
                    </div>
                    <span className={cn(
                      'shrink-0 text-sm font-medium',
                      item.acquired && 'text-muted-foreground'
                    )}>
                      {item.price}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-semibold md:text-3xl">Wishlists</h1>
          <p className="text-sm text-muted-foreground">Track cards you&apos;re looking to acquire.</p>
        </div>
        <NewWishlistDialog store={store} />
      </div>

      {store.wishlists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Heart className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-base font-medium text-muted-foreground">No wishlists yet</p>
            <p className="text-sm text-muted-foreground/80">Create one to start tracking cards you want.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:gap-4 md:grid-cols-2 xl:grid-cols-3">
          {store.wishlists.map((list) => {
            const completed = list.items.filter((i) => i.acquired).length;
            const pct = list.items.length > 0 ? Math.round((completed / list.items.length) * 100) : 0;
            return (
              <Card
                key={list.id}
                className="cursor-pointer transition hover:border-primary/50 hover:shadow-md"
                onClick={() => setSelectedWishlist(list.id)}
              >
                <CardHeader className="p-4 md:p-6">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm md:text-base">{list.name}</CardTitle>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <CardDescription>{list.items.length} cards &bull; {pct}% complete</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                  <div className="space-y-1.5">
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {completed} of {list.items.length} acquired
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New Wishlist Dialog                                                  */
/* ------------------------------------------------------------------ */

function NewWishlistDialog({ store }: { store: ReturnType<typeof useDemoStore> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const handleCreate = () => {
    if (!name.trim()) return;
    store.addWishlist(name.trim());
    setName('');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" />
          New
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create wishlist</DialogTitle>
          <DialogDescription>Add a new wishlist to track cards you want.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <div className="space-y-2">
            <Label htmlFor="wishlist-name">Name</Label>
            <Input
              id="wishlist-name"
              placeholder="e.g. Birthday Wants"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>Create wishlist</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
