'use client';

import { BarChart3, TrendingUp, TrendingDown, DollarSign, Layers, Calendar } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/* ------------------------------------------------------------------ */
/*  Fake analytics data                                                */
/* ------------------------------------------------------------------ */

const MONTHLY_VALUES = [
  { month: 'Oct', value: 1420 },
  { month: 'Nov', value: 1580 },
  { month: 'Dec', value: 1750 },
  { month: 'Jan', value: 1690 },
  { month: 'Feb', value: 1830 },
  { month: 'Mar', value: 2045 },
];

const TOP_GAINERS = [
  { name: 'Charizard ex', tcg: 'Pokemon', change: +18.5, price: 85.0 },
  { name: 'Ragavan, Nimble Pilferer', tcg: 'Magic', change: +12.3, price: 68.4 },
  { name: 'Pot of Prosperity', tcg: 'Yu-Gi-Oh!', change: +8.7, price: 22.5 },
  { name: 'Umbreon ex', tcg: 'Pokemon', change: +6.2, price: 42.0 },
  { name: 'Wrenn and Six', tcg: 'Magic', change: +5.1, price: 55.0 },
];

const TOP_LOSERS = [
  { name: 'Fury', tcg: 'Magic', change: -15.2, price: 12.0 },
  { name: 'Grief', tcg: 'Magic', change: -11.8, price: 8.5 },
  { name: 'Mewtwo VSTAR', tcg: 'Pokemon', change: -7.3, price: 7.5 },
  { name: 'Pikachu VMAX', tcg: 'Pokemon', change: -4.1, price: 24.5 },
  { name: 'Mirror Force', tcg: 'Yu-Gi-Oh!', change: -3.5, price: 4.0 },
];

const GAME_BREAKDOWN = [
  { game: 'Yu-Gi-Oh!', cards: 38, value: 412.5, color: '#ef4444' },
  { game: 'Magic: The Gathering', cards: 52, value: 890.25, color: '#8b5cf6' },
  { game: 'Pokemon', cards: 45, value: 742.75, color: '#f59e0b' },
];

const RARITY_DIST = [
  { rarity: 'Common / Uncommon', count: 32, pct: 24 },
  { rarity: 'Rare', count: 28, pct: 21 },
  { rarity: 'Ultra / Secret Rare', count: 41, pct: 30 },
  { rarity: 'Mythic / Special Art', count: 34, pct: 25 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const totalValue = GAME_BREAKDOWN.reduce((s, g) => s + g.value, 0);
  const totalCards = GAME_BREAKDOWN.reduce((s, g) => s + g.cards, 0);
  const maxBarValue = Math.max(...MONTHLY_VALUES.map((m) => m.value));

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Collection value trends, price movers, and distribution breakdowns.
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
          <StatCard title="Total Value" value={`$${totalValue.toFixed(2)}`} icon={<DollarSign className="h-5 w-5" />} sub="Across all games" />
          <StatCard title="Total Cards" value={totalCards} icon={<Layers className="h-5 w-5" />} sub="135 unique cards" />
          <StatCard title="30-Day Change" value="+$215.00" icon={<TrendingUp className="h-5 w-5" />} sub="+11.7% this month" positive />
          <StatCard title="Avg Card Value" value={`$${(totalValue / totalCards).toFixed(2)}`} icon={<BarChart3 className="h-5 w-5" />} sub="Per card average" />
        </div>

        {/* Value over time chart (simple bar chart) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Collection Value Over Time
            </CardTitle>
            <CardDescription>Monthly estimated total value (last 6 months).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-48">
              {MONTHLY_VALUES.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground font-medium">${m.value}</span>
                  <div
                    className="w-full rounded-t bg-primary/80 transition-all"
                    style={{ height: `${(m.value / maxBarValue) * 100}%` }}
                  />
                  <span className="text-xs text-muted-foreground">{m.month}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top gainers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                Top Gainers (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {TOP_GAINERS.map((c) => (
                  <div key={c.name} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.tcg}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">${c.price.toFixed(2)}</p>
                      <p className="text-xs text-green-500">+{c.change}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top losers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-500" />
                Top Losers (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {TOP_LOSERS.map((c) => (
                  <div key={c.name} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.tcg}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">${c.price.toFixed(2)}</p>
                      <p className="text-xs text-red-500">{c.change}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Game breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Value by Game</CardTitle>
              <CardDescription>How your collection value is distributed across TCGs.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {GAME_BREAKDOWN.map((g) => {
                  const pct = Math.round((g.value / totalValue) * 100);
                  return (
                    <div key={g.game} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{g.game}</span>
                        <span className="text-muted-foreground">${g.value.toFixed(2)} ({pct}%)</span>
                      </div>
                      <div className="h-3 rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: g.color }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{g.cards} cards</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rarity distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Rarity Distribution</CardTitle>
              <CardDescription>Breakdown of your collection by rarity tier.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {RARITY_DIST.map((r) => (
                  <div key={r.rarity} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{r.rarity}</span>
                      <span className="text-muted-foreground">{r.count} cards ({r.pct}%)</span>
                    </div>
                    <div className="h-3 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${r.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ title, value, icon, sub, positive }: { title: string; value: string | number; icon: React.ReactNode; sub: string; positive?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className={`text-xl md:text-3xl font-semibold tracking-tight ${positive ? 'text-green-500' : ''}`}>{value}</div>
        <p className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
