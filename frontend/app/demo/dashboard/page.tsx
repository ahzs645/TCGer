'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowUpRight,
  Coins,
  Heart,
  LayoutDashboard,
  Library,
  LogOut,
  Moon,
  Search,
  Sparkles,
  Sun,
  Table,
  User
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_STATS = {
  totalCards: 1_247,
  estimatedValue: 8_432.5,
  activeGames: 3,
  recentAdditions: 5
};

const MOCK_GAMES = [
  { name: 'Yu-Gi-Oh!', copies: 542, pct: 43 },
  { name: 'Magic: The Gathering', copies: 438, pct: 35 },
  { name: 'Pok\u00e9mon', copies: 267, pct: 22 }
];

const MOCK_RECENT = [
  { id: '1', name: 'Blue-Eyes White Dragon', tcg: 'Yu-Gi-Oh!', binder: 'Main Deck', date: 'Feb 24' },
  { id: '2', name: 'Lightning Bolt', tcg: 'Magic: The Gathering', binder: 'Modern Staples', date: 'Feb 23' },
  { id: '3', name: 'Charizard ex', tcg: 'Pok\u00e9mon', binder: 'Scarlet & Violet', date: 'Feb 22' },
  { id: '4', name: 'Ash Blossom & Joyous Spring', tcg: 'Yu-Gi-Oh!', binder: 'Staples', date: 'Feb 21' },
  { id: '5', name: 'Mewtwo VSTAR', tcg: 'Pok\u00e9mon', binder: 'Vintage Box', date: 'Feb 20' }
];

const MOCK_BINDERS = [
  { id: 'b1', name: 'Main Deck', color: '#3b82f6', cards: 182, game: 'Yu-Gi-Oh!' },
  { id: 'b2', name: 'Modern Staples', color: '#8b5cf6', cards: 245, game: 'Magic' },
  { id: 'b3', name: 'Scarlet & Violet', color: '#ef4444', cards: 128, game: 'Pok\u00e9mon' },
  { id: 'b4', name: 'Staples', color: '#f59e0b', cards: 360, game: 'Yu-Gi-Oh!' },
  { id: 'b5', name: 'Vintage Box', color: '#10b981', cards: 139, game: 'Pok\u00e9mon' },
  { id: 'b6', name: 'Commander', color: '#6366f1', cards: 193, game: 'Magic' }
];

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

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function DemoDashboardPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>('dashboard');
  const { theme, setTheme } = useTheme();

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
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="hidden sm:inline">demo@tcger.app</span>
            </div>
            <Button variant="ghost" size="icon" asChild>
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
/*  Dashboard tab                                                       */
/* ------------------------------------------------------------------ */

function DemoDashboard() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <StatCard
          title="Total Cards"
          value={MOCK_STATS.totalCards.toLocaleString()}
          description="Across all tracked TCGs"
          icon={<Library className="h-5 w-5" />}
        />
        <StatCard
          title="Estimated Value"
          value={`$${MOCK_STATS.estimatedValue.toFixed(2)}`}
          description="Based on collection pricing"
          icon={<Coins className="h-5 w-5" />}
        />
        <StatCard
          title="Active Games"
          value={MOCK_STATS.activeGames}
          description="Games with cards in your library"
          icon={<Sparkles className="h-5 w-5" />}
        />
        <StatCard
          title="Recent Additions"
          value={`${MOCK_STATS.recentAdditions} cards`}
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
          <div className="grid gap-3 md:gap-4 md:grid-cols-3">
            {MOCK_GAMES.map((game) => (
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

      {/* Recent activity */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-xl">Recent Activity</CardTitle>
          <CardDescription>Latest updates across your binders.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <div className="space-y-2 md:space-y-4">
            {MOCK_RECENT.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/50 hover:bg-muted/40 md:gap-4 md:p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-none truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.tcg} &bull; {item.binder}
                  </p>
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

function DemoCollections() {
  const [selectedBinder, setSelectedBinder] = useState<string | null>(null);
  const activeBinder = MOCK_BINDERS.find((b) => b.id === selectedBinder);

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
          <Button variant="outline" size="sm" disabled>+ New</Button>
        </div>
        <Select value={selectedBinder ?? ''} onValueChange={setSelectedBinder}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a binder..." />
          </SelectTrigger>
          <SelectContent>
            {MOCK_BINDERS.map((binder) => (
              <SelectItem key={binder.id} value={binder.id}>
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: binder.color }} />
                  {binder.name}
                  <span className="text-muted-foreground">&middot; {binder.cards}</span>
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
            <Button variant="outline" size="sm" disabled>+ New</Button>
          </div>
          <div className="space-y-1">
            {MOCK_BINDERS.map((binder) => (
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
                  <p className="text-xs text-muted-foreground">{binder.game} &bull; {binder.cards} cards</p>
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
          ) : (
            <>
              <CardHeader className="p-4 md:p-6">
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: activeBinder?.color }}
                  />
                  <div>
                    <CardTitle className="text-base md:text-xl">{activeBinder?.name}</CardTitle>
                    <CardDescription>
                      {activeBinder?.cards} cards &bull; {activeBinder?.game}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                <div className="rounded-lg border">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide md:grid-cols-[1fr_100px_80px] md:gap-4 md:px-4 md:py-3">
                    <span>Card Name</span>
                    <span>Cond.</span>
                    <span className="text-right">Price</span>
                  </div>
                  {[
                    { name: 'Blue-Eyes White Dragon', condition: 'NM', price: '$24.99' },
                    { name: 'Dark Magician', condition: 'LP', price: '$12.50' },
                    { name: 'Red-Eyes Black Dragon', condition: 'NM', price: '$8.75' },
                    { name: 'Pot of Greed', condition: 'MP', price: '$3.20' },
                    { name: 'Monster Reborn', condition: 'NM', price: '$5.00' }
                  ].map((card) => (
                    <div
                      key={card.name}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/20 transition md:grid-cols-[1fr_100px_80px] md:gap-4 md:px-4 md:py-3"
                    >
                      <span className="font-medium">{card.name}</span>
                      <Badge variant="secondary" className="w-fit text-xs">{card.condition}</Badge>
                      <span className="text-right">{card.price}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wishlists tab                                                       */
/* ------------------------------------------------------------------ */

function DemoWishlists() {
  const wishlists = [
    { name: 'Must-Have Staples', items: 12, completed: 7 },
    { name: 'Scarlet & Violet Chase Cards', items: 8, completed: 3 },
    { name: 'Modern Upgrades', items: 15, completed: 9 }
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-semibold md:text-3xl">Wishlists</h1>
        <p className="text-sm text-muted-foreground">Track cards you&apos;re looking to acquire.</p>
      </div>

      <div className="grid gap-3 md:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {wishlists.map((list) => {
          const pct = Math.round((list.completed / list.items) * 100);
          return (
            <Card key={list.name} className="cursor-pointer transition hover:border-primary/50 hover:shadow-md">
              <CardHeader className="p-4 md:p-6">
                <CardTitle className="text-sm md:text-base">{list.name}</CardTitle>
                <CardDescription>{list.items} cards &bull; {pct}% complete</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {list.completed} of {list.items} acquired
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
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
