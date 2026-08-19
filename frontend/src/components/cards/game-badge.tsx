import { cn } from "@/lib/utils";
import { gamePresentation } from "@/lib/games";

interface GameBadgeProps {
  /** Game code (`"magic"`) or display name (`"Magic: The Gathering"`). */
  game?: string | null;
  /** Use the full name instead of the compact one. */
  long?: boolean;
  /** Drop the mark and show text only — for very dense rows. */
  hideIcon?: boolean;
  className?: string;
}

/**
 * The chip that identifies which game a card, product or deck belongs to.
 *
 * iOS pairs a game's mark with its brand colour everywhere it names a game; the
 * web rendered a bare outlined chip whose border colour came from whichever of
 * eight local colour maps the page happened to define. This reads from the one
 * shared source, so the same game looks the same on every page — and the three
 * games those maps omitted now have a colour at all.
 */
export function GameBadge({
  game,
  long = false,
  hideIcon = false,
  className,
}: GameBadgeProps) {
  const { label, shortLabel, color, icon } = gamePresentation(game);
  const text = long ? label : shortLabel;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-none",
        className,
      )}
      style={{
        borderColor: `${color}66`,
        backgroundColor: `${color}1f`,
        color,
      }}
      title={label}
      data-oid="game-badge"
    >
      {icon && !hideIcon ? (
        /*
         * Masked rather than <img>: the marks ship as solid black artwork, and a
         * mask paints them in the exact brand colour in either theme instead of
         * approximating it with a filter chain.
         */
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0"
          style={{
            backgroundColor: color,
            maskImage: `url(${icon})`,
            WebkitMaskImage: `url(${icon})`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
          }}
        />
      ) : null}
      <span className="truncate">{text}</span>
    </span>
  );
}
