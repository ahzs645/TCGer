import {
  Check,
  Compass,
  FolderHeart,
  Gamepad2,
  Layers3,
  Library,
  ListChecks,
  LockKeyhole,
  Medal,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  nextCollectionAchievement,
  type AchievementId,
  type CollectionAchievement,
} from "@/lib/achievements/achievements";
import { cn } from "@/lib/utils";

const ICONS: Record<AchievementId, LucideIcon> = {
  "first-card": Library,
  "copy-collector": Layers3,
  "card-curator": Medal,
  "binder-builder": FolderHeart,
  "cross-game": Gamepad2,
  "wishlist-planner": ListChecks,
  "set-explorer": Compass,
  "set-complete": Trophy,
};

export function AchievementsSection({
  achievements,
}: {
  achievements: CollectionAchievement[];
}) {
  const unlockedCount = achievements.filter(
    (achievement) => achievement.unlocked,
  ).length;
  const nextAchievement = nextCollectionAchievement(achievements);

  return (
    <Card
      className="overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/[0.07] via-card to-card"
      data-achievements
    >
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <Trophy className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <CardTitle>Collection achievements</CardTitle>
            <CardDescription>
              Milestones earned by collecting, organizing, and exploring more of
              the hobby.
            </CardDescription>
          </div>
        </div>
        <div className="shrink-0 rounded-lg border bg-background/70 px-3 py-2 text-right shadow-sm">
          <p className="text-xl font-semibold tabular-nums">
            {unlockedCount}/{achievements.length}
          </p>
          <p className="text-xs text-muted-foreground">unlocked</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {nextAchievement ? (
          <div className="rounded-xl border border-primary/20 bg-background/75 p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Up next · </span>
                <span className="font-semibold">{nextAchievement.title}</span>
              </div>
              <span className="shrink-0 font-medium tabular-nums">
                {formatProgress(nextAchievement)}
              </span>
            </div>
            <ProgressBar achievement={nextAchievement} emphasized />
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm">
            <Check className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            <span className="font-medium">
              Every collection milestone is unlocked.
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {achievements.map((achievement) => (
            <AchievementTile key={achievement.id} achievement={achievement} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AchievementTile({
  achievement,
}: {
  achievement: CollectionAchievement;
}) {
  const Icon = ICONS[achievement.id];

  return (
    <article
      className={cn(
        "flex flex-col rounded-xl border p-4 transition-colors sm:min-h-48",
        achievement.unlocked
          ? "border-amber-500/30 bg-amber-500/[0.08]"
          : "bg-background/55",
      )}
      data-achievement={achievement.id}
      data-unlocked={achievement.unlocked}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            achievement.unlocked
              ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <Badge
          variant={achievement.unlocked ? "default" : "outline"}
          className={cn(
            achievement.unlocked &&
              "border-amber-500/30 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-200",
          )}
        >
          {achievement.unlocked ? (
            <Check className="mr-1 h-3 w-3" aria-hidden="true" />
          ) : (
            <LockKeyhole className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          {achievement.unlocked ? "Unlocked" : "In progress"}
        </Badge>
      </div>
      <div className="mt-4 flex-1">
        <h3 className="font-heading font-semibold">{achievement.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {achievement.description}
        </p>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium tabular-nums">
            {formatProgress(achievement)}
          </span>
        </div>
        <ProgressBar achievement={achievement} />
      </div>
    </article>
  );
}

function formatProgress(achievement: CollectionAchievement): string {
  return `${Math.min(achievement.current, achievement.target)}/${achievement.target} ${achievement.unit}`;
}

function ProgressBar({
  achievement,
  emphasized = false,
}: {
  achievement: CollectionAchievement;
  emphasized?: boolean;
}) {
  return (
    <div className={cn("rounded-full bg-muted", emphasized ? "h-2.5" : "h-2")}>
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          achievement.unlocked ? "bg-amber-500" : "bg-primary",
        )}
        style={{ width: `${achievement.progressPercent}%` }}
        role="progressbar"
        aria-label={`${achievement.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={achievement.progressPercent}
      />
    </div>
  );
}
