import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** Buttons, menus and dialog triggers for this page. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * One header layout for every page that pairs a title with page-level actions.
 *
 * Four pages used to do this three different ways: Transactions stacked the
 * action below the description (right), Trades and Sealed put it beside a title
 * that then wrapped to two lines, and Collections let the action row wrap
 * *between* the heading and the sentence explaining it. Below `sm` the actions
 * always come last, so the heading and its description stay adjacent.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
      data-oid="page-header"
    >
      <div className="min-w-0 space-y-1">
        <h1 className="font-heading text-3xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
