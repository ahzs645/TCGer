import {
  ArrowDownRight,
  ArrowUpRight,
  Layers,
  Library,
  PieChart,
  Wallet,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CollectionCard } from "@/types/card";

interface CollectionSummaryProps {
  items: CollectionCard[];
  selectedIds: string[];
  totalQuantity: number;
  totalValue: number;
  showPricing: boolean;
}

export function CollectionSummary({
  items,
  selectedIds,
  totalQuantity,
  totalValue,
  showPricing,
}: CollectionSummaryProps) {
  const selectedCards = items.filter((card) => selectedIds.includes(card.id));
  const selectedValue = selectedCards.reduce(
    (sum, card) => sum + (card.price ?? 0) * card.quantity,
    0,
  );
  const selectedQuantity = selectedCards.reduce(
    (sum, card) => sum + card.quantity,
    0,
  );
  const uniqueCount = new Set(items.map((card) => card.cardId ?? card.id)).size;
  const binderCount = new Set(items.map((card) => card.binderId ?? "default"))
    .size;
  const avgPrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
  const delta = showPricing ? computeDelta(items) : undefined;

  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      data-oid="rst8x3z"
    >
      <SummaryCard
        title="Total inventory"
        description={`${uniqueCount} unique cards`}
        value={`${totalQuantity} copies`}
        icon={<Layers className="h-5 w-5" data-oid="qzo_4f." />}
        data-oid="0uq65e_"
      />

      {showPricing ? (
        <>
          <SummaryCard
            title="Portfolio value"
            description="Live estimates"
            value={`$${totalValue.toFixed(2)}`}
            icon={<Wallet className="h-5 w-5" data-oid=":su1y1e" />}
            delta={delta}
            data-oid="k1c0yaj"
          />

          <SummaryCard
            title="Avg. price"
            description="Per copy"
            value={`$${avgPrice.toFixed(2)}`}
            icon={<PieChart className="h-5 w-5" data-oid="flfgm8k" />}
            data-oid="c6jzg:9"
          />

          <SummaryCard
            title="Selected for export"
            description={`${selectedCards.length} card(s), ${selectedQuantity} copies`}
            value={`$${selectedValue.toFixed(2)}`}
            icon={<ArrowUpRight className="h-5 w-5" data-oid="_p13n6r" />}
            variant="muted"
            data-oid="eoqyn5b"
          />
        </>
      ) : (
        <>
          <SummaryCard
            title="Active binders"
            description="Binders containing cards"
            value={binderCount.toString()}
            icon={<Library className="h-5 w-5" data-oid="cjdk-2b" />}
            data-oid="n34zhh3"
          />

          <SummaryCard
            title="Selected cards"
            description={`You picked ${selectedQuantity} copies`}
            value={`${selectedCards.length} titles`}
            icon={<ArrowUpRight className="h-5 w-5" data-oid=".srp.4a" />}
            variant="muted"
            data-oid="it80khw"
          />
        </>
      )}
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  description: string;
  value: string;
  icon: React.ReactNode;
  variant?: "default" | "muted";
  delta?: number;
}

function SummaryCard({
  title,
  description,
  value,
  icon,
  variant = "default",
  delta,
}: SummaryCardProps) {
  const positive = delta !== undefined && delta >= 0;

  return (
    <Card
      className={variant === "muted" ? "border-dashed bg-muted/30" : ""}
      data-oid="e000uzq"
    >
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 pb-2"
        data-oid="lrff2mo"
      >
        <CardTitle
          className="text-sm font-medium text-muted-foreground"
          data-oid="e-r4m-4"
        >
          {title}
        </CardTitle>
        <span className="text-muted-foreground" data-oid="47xh055">
          {icon}
        </span>
      </CardHeader>
      <CardContent className="space-y-1" data-oid="fshhr95">
        <div
          className="text-2xl font-semibold tracking-tight"
          data-oid="mln1pcq"
        >
          {value}
        </div>
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-oid="bzuyqbw"
        >
          <span data-oid="1fcghzl">{description}</span>
          {delta !== undefined && (
            <TooltipProvider data-oid="csrpr_-">
              <Tooltip data-oid="fu5mxjj">
                <TooltipTrigger
                  className={positive ? "text-emerald-500" : "text-red-500"}
                  data-oid=":kaetm9"
                >
                  <div className="flex items-center gap-1" data-oid="cfqeoy5">
                    {positive ? (
                      <ArrowUpRight className="h-3 w-3" data-oid="q2iecbn" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" data-oid=":05ui_u" />
                    )}
                    {Math.abs(delta).toFixed(1)}%
                  </div>
                </TooltipTrigger>
                <TooltipContent data-oid="wrrpt16">
                  Pricing change over the last sync window.
                </TooltipContent>
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
    const previousEntry =
      history.length > 1 ? history[history.length - 2] : undefined;
    const latestEntry = history.length
      ? history[history.length - 1]
      : undefined;
    const previous =
      previousEntry !== undefined
        ? typeof previousEntry === "number"
          ? previousEntry
          : previousEntry.price
        : (card.price ?? 0);
    const latest =
      latestEntry !== undefined
        ? typeof latestEntry === "number"
          ? latestEntry
          : latestEntry.price
        : undefined;
    const current = card.price ?? latest ?? previous;
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  });
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(avg.toFixed(2));
}
