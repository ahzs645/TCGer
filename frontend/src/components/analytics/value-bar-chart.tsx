import { cn } from "@/lib/utils";

export interface ValueBarChartPoint {
  /** Stable react key. */
  key: string;
  /** Axis label under the bar. */
  label: string;
  value: number;
}

interface ValueBarChartProps {
  points: ValueBarChartPoint[];
  /** Renders both the per-bar label and the axis ceiling. */
  formatValue: (value: number) => string;
  ariaLabel: string;
  className?: string;
}

/**
 * The value-over-time chart shared by the live and demo analytics pages.
 *
 * Both used to paint bare `bg-primary/80` bars in a flex row. `--primary` is
 * near-white in dark mode and near-black in light mode, so the chart rendered
 * as a row of flat grey slabs with no baseline, no gridlines and no axis — the
 * largest element on the page carried the least information. This keeps the
 * honest zero baseline but adds the scaffolding a reader needs to decode it,
 * and paints the bars with the dedicated chart ramp.
 */
export function ValueBarChart({
  points,
  formatValue,
  ariaLabel,
  className,
}: ValueBarChartProps) {
  if (points.length === 0) return null;

  const peak = Math.max(...points.map((point) => point.value), 0);
  // Head-room above the tallest bar so it does not touch the top gridline.
  const ceiling = peak > 0 ? peak * 1.08 : 1;
  const gridLines = [1, 0.75, 0.5, 0.25, 0];

  return (
    <figure className={cn("m-0", className)}>
      <div role="img" aria-label={ariaLabel} data-oid="value-bar-chart">
        {/* Value row, outside the plot box so the gridlines can align to it. */}
        <div className="hidden gap-1 pb-1 min-[360px]:flex sm:gap-3">
          {points.map((point) => (
            <span
              key={point.key}
              className="min-w-0 flex-1 truncate text-center text-xs font-medium text-muted-foreground"
            >
              {formatValue(point.value)}
            </span>
          ))}
        </div>

        <div className="relative h-48">
          <div className="flex h-full items-end gap-1 sm:gap-3">
            {points.map((point) => {
              const heightPct = Math.max(2, (point.value / ceiling) * 100);
              return (
                <div
                  key={point.key}
                  className="flex h-full min-w-0 flex-1 items-end"
                  title={`${point.label}: ${formatValue(point.value)}`}
                >
                  <div
                    className="w-full rounded-t bg-chart-1 transition-all"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>

          {/*
           * Gridlines paint *over* the bars. Behind them they would be invisible
           * — bars drawn from a zero baseline cover most of the plot — and the
           * quarter marks are exactly what lets a reader judge how much taller
           * one month is than another.
           */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col justify-between"
          >
            {gridLines.map((fraction) => (
              <div
                key={fraction}
                className={cn(
                  "w-full border-t",
                  fraction === 0 ? "border-chart-grid" : "border-background/35",
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-1 pt-1.5 sm:gap-3">
          {points.map((point) => (
            <span
              key={point.key}
              className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground"
            >
              {point.label}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">
        {ariaLabel}. Bars are drawn from a zero baseline; gridlines mark
        quarters of {formatValue(ceiling)}.
      </figcaption>
    </figure>
  );
}
