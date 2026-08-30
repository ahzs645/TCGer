import type { YugiohBanlistEntry, YugiohBanlistStatus } from "@tcg/api-types";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const labels: Record<YugiohBanlistStatus, string> = {
  forbidden: "Forbidden · 0",
  limited: "Limited · 1",
  "semi-limited": "Semi-Limited · 2",
};

export function YugiohLimitBadge({
  entry,
  compact = false,
}: {
  entry?: YugiohBanlistEntry;
  compact?: boolean;
}) {
  if (!entry) return null;
  return (
    <Badge
      variant="outline"
      title={`${entry.cardName}: maximum ${entry.limit}`}
      className={cn(
        "whitespace-nowrap text-[10px] font-semibold",
        entry.status === "forbidden" && "border-red-500/70 bg-red-500/10 text-red-700 dark:text-red-300",
        entry.status === "limited" && "border-amber-500/70 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        entry.status === "semi-limited" && "border-sky-500/70 bg-sky-500/10 text-sky-800 dark:text-sky-300",
      )}
    >
      {compact ? entry.limit : labels[entry.status]}
    </Badge>
  );
}
