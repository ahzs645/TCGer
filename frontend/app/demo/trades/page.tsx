'use client';

import { useState } from 'react';
import { Repeat2, ArrowRight, Check, Clock, X, Plus } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ------------------------------------------------------------------ */
/*  Fake trade data                                                     */
/* ------------------------------------------------------------------ */

interface TradeCard {
  name: string;
  tcg: string;
  value: number;
}

interface Trade {
  id: string;
  partner: string;
  status: 'completed' | 'pending' | 'declined';
  date: string;
  giving: TradeCard[];
  receiving: TradeCard[];
}

const TRADES: Trade[] = [
  {
    id: 't1',
    partner: 'CardMaster42',
    status: 'completed',
    date: '2025-03-15',
    giving: [
      { name: 'Fury', tcg: 'Magic', value: 12.0 },
      { name: 'Grief', tcg: 'Magic', value: 8.5 },
    ],
    receiving: [
      { name: 'Ash Blossom & Joyous Spring', tcg: 'Yu-Gi-Oh!', value: 5.5 },
      { name: 'Nibiru, the Primal Being', tcg: 'Yu-Gi-Oh!', value: 8.95 },
      { name: 'Effect Veiler', tcg: 'Yu-Gi-Oh!', value: 3.8 },
    ],
  },
  {
    id: 't2',
    partner: 'PikachuCollector',
    status: 'completed',
    date: '2025-03-10',
    giving: [
      { name: 'Mewtwo VSTAR', tcg: 'Pokemon', value: 7.5 },
      { name: 'Pikachu', tcg: 'Pokemon', value: 2.5 },
    ],
    receiving: [
      { name: 'Iono', tcg: 'Pokemon', value: 32.0 },
    ],
  },
  {
    id: 't3',
    partner: 'ModernMage',
    status: 'pending',
    date: '2025-03-18',
    giving: [
      { name: 'Solitude', tcg: 'Magic', value: 32.0 },
    ],
    receiving: [
      { name: 'Ragavan, Nimble Pilferer', tcg: 'Magic', value: 68.4 },
    ],
  },
  {
    id: 't4',
    partner: 'DuelistKing',
    status: 'completed',
    date: '2025-02-28',
    giving: [
      { name: 'Pot of Greed', tcg: 'Yu-Gi-Oh!', value: 3.2 },
      { name: 'Monster Reborn', tcg: 'Yu-Gi-Oh!', value: 5.0 },
      { name: 'Raigeki', tcg: 'Yu-Gi-Oh!', value: 6.25 },
    ],
    receiving: [
      { name: 'Accesscode Talker', tcg: 'Yu-Gi-Oh!', value: 18.0 },
    ],
  },
  {
    id: 't5',
    partner: 'VintageVault',
    status: 'declined',
    date: '2025-03-05',
    giving: [
      { name: 'Charizard ex', tcg: 'Pokemon', value: 85.0 },
    ],
    receiving: [
      { name: 'Lightning Bolt', tcg: 'Magic', value: 1.5 },
      { name: 'Counterspell', tcg: 'Magic', value: 2.25 },
    ],
  },
  {
    id: 't6',
    partner: 'TradeKing99',
    status: 'pending',
    date: '2025-03-19',
    giving: [
      { name: 'Endurance', tcg: 'Magic', value: 26.0 },
      { name: 'Fatal Push', tcg: 'Magic', value: 3.5 },
    ],
    receiving: [
      { name: 'Wrenn and Six', tcg: 'Magic', value: 55.0 },
    ],
  },
  {
    id: 't7',
    partner: 'PKMNTrader',
    status: 'completed',
    date: '2025-02-14',
    giving: [
      { name: 'Palkia VSTAR', tcg: 'Pokemon', value: 9.75 },
    ],
    receiving: [
      { name: 'Gardevoir ex', tcg: 'Pokemon', value: 6.25 },
      { name: 'Eevee', tcg: 'Pokemon', value: 0.75 },
      { name: "Boss's Orders", tcg: 'Pokemon', value: 2.5 },
    ],
  },
];

const STATUS_CONFIG = {
  completed: { label: 'Completed', icon: Check, color: 'text-green-500', bg: 'bg-green-500/10' },
  pending: { label: 'Pending', icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  declined: { label: 'Declined', icon: X, color: 'text-red-500', bg: 'bg-red-500/10' },
};

export default function TradesPage() {
  const [tab, setTab] = useState('all');

  const filtered = tab === 'all' ? TRADES : TRADES.filter((t) => t.status === tab);

  const completedTrades = TRADES.filter((t) => t.status === 'completed');
  const totalGiven = completedTrades.reduce((s, t) => s + t.giving.reduce((a, c) => a + c.value, 0), 0);
  const totalReceived = completedTrades.reduce((s, t) => s + t.receiving.reduce((a, c) => a + c.value, 0), 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-heading font-semibold">Trades</h1>
            <p className="text-sm text-muted-foreground">Track card trades with other collectors.</p>
          </div>
          <Button size="sm" disabled>
            <Plus className="mr-2 h-4 w-4" />
            New Trade
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
          <Card>
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Total Trades</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-xl md:text-3xl font-semibold">{TRADES.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-xl md:text-3xl font-semibold text-green-500">{completedTrades.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Value Sent</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-xl md:text-3xl font-semibold">${totalGiven.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Value Received</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-xl md:text-3xl font-semibold">${totalReceived.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All ({TRADES.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({TRADES.filter((t) => t.status === 'pending').length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedTrades.length})</TabsTrigger>
            <TabsTrigger value="declined">Declined ({TRADES.filter((t) => t.status === 'declined').length})</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Trade list */}
        <div className="space-y-4">
          {filtered.map((trade) => {
            const givingTotal = trade.giving.reduce((s, c) => s + c.value, 0);
            const receivingTotal = trade.receiving.reduce((s, c) => s + c.value, 0);
            const cfg = STATUS_CONFIG[trade.status];
            const StatusIcon = cfg.icon;

            return (
              <Card key={trade.id}>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Repeat2 className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Trade with {trade.partner}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`${cfg.color} ${cfg.bg}`}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(trade.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
                    {/* Giving */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">You give</p>
                      {trade.giving.map((c, i) => (
                        <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
                          <div>
                            <span className="font-medium">{c.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{c.tcg}</span>
                          </div>
                          <span className="text-muted-foreground">${c.value.toFixed(2)}</span>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground text-right">Total: ${givingTotal.toFixed(2)}</p>
                    </div>

                    {/* Arrow */}
                    <div className="hidden md:flex items-center justify-center">
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* Receiving */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">You receive</p>
                      {trade.receiving.map((c, i) => (
                        <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
                          <div>
                            <span className="font-medium">{c.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{c.tcg}</span>
                          </div>
                          <span className="text-muted-foreground">${c.value.toFixed(2)}</span>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground text-right">Total: ${receivingTotal.toFixed(2)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
