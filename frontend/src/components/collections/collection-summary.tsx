import { ArrowDownRight, ArrowUpRight, Layers, PieChart, Wallet } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CollectionCard } from '@/types/card';

interface CollectionSummaryProps {
  items: CollectionCard[];
  selectedIds: string[];
  totalQuantity: number;
  totalValue: number;
}

export function CollectionSummary({ items, selectedIds, totalQuantity, totalValue }: CollectionSummaryProps) {
  const selectedCards = items.filter((card) => selectedIds.includes(card.id));
  const selectedValue = selectedCards.reduce((sum, card) => sum + (card.price ?? 0) * card.quantity, 0);
  const avgPrice = items.length ? totalValue / totalQuantity : 0;
  const delta = computeDelta(items);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        title="Total inventory"
        description={`${items.length} unique cards`}
        value={`${totalQuantity} copies`}
        icon={<Layers className="h-5 w-5" />}
      />
      <SummaryCard
        title="Portfolio value"
        description="live estimates"
        value={`$${totalValue.toFixed(2)}`}
        icon={<Wallet className="h-5 w-5" />}
        delta={delta}
      />
      <SummaryCard
        title="Avg. price"
        description="per copy"
        value={`$${avgPrice.toFixed(2)}`}
        icon={<PieChart className="h-5 w-5" />}
      />
      <SummaryCard
        title="Selected for export"
        description={`${selectedCards.length} card(s)`}
        value={`$${selectedValue.toFixed(2)}`}
        icon={<ArrowUpRight className="h-5 w-5" />}
        variant="muted"
      />
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  description: string;
  value: string;
  icon: React.ReactNode;
  variant?: 'default' | 'muted';
  delta?: number;
}

function SummaryCard({ title, description, value, icon, variant = 'default', delta }: SummaryCardProps) {
  const positive = delta !== undefined && delta >= 0;

  return (
    <Card className={variant === 'muted' ? 'border-dashed bg-muted/30' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{description}</span>
          {delta !== undefined && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className={positive ? 'text-emerald-500' : 'text-red-500'}>
                  <div className="flex items-center gap-1">
                    {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(delta).toFixed(1)}%
                  </div>
                </TooltipTrigger>
                <TooltipContent>Pricing change over the last sync window.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function computeDelta(items: CollectionCard[]): number {
  if (!items.length) return 0;
  const values = items.map((card) => {
    const history = card.priceHistory ?? [];
    const previous = history.length > 1 ? history[history.length - 2] : card.price ?? 0;
    const current = card.price ?? previous;
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  });
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(avg.toFixed(2));
}
