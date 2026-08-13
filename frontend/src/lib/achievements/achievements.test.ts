import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCollectionAchievements,
  nextCollectionAchievement,
  summarizeAchievementMetrics,
} from "./achievements";

test("summarizes copies, identities and games without counting empty rows", () => {
  const metrics = summarizeAchievementMetrics({
    cards: [
      { tcg: "pokemon", externalId: "sv1-1", quantity: 2 },
      { tcg: "pokemon", externalId: "sv1-1", quantity: 3 },
      { tcg: "magic", externalId: "mh2-1", quantity: 1 },
      { tcg: "yugioh", externalId: "lob-1", quantity: 0 },
    ],
    binderCount: 2,
    wishlistCount: 1,
    setCompletionPercents: [12, 44, Number.NaN],
  });

  assert.deepEqual(metrics, {
    totalCopies: 6,
    uniqueCards: 2,
    representedGames: 2,
    binderCount: 2,
    wishlistCount: 1,
    bestSetCompletion: 44,
  });
});

test("derives deterministic progress and unlock state", () => {
  const achievements = deriveCollectionAchievements({
    cards: Array.from({ length: 25 }, (_, index) => ({
      tcg: index % 2 ? "pokemon" : "magic",
      externalId: `card-${index}`,
      quantity: 2,
    })),
    binderCount: 3,
    wishlistCount: 1,
    setCompletionPercents: [25],
  });

  assert.equal(
    achievements.find(({ id }) => id === "first-card")?.unlocked,
    true,
  );
  assert.equal(
    achievements.find(({ id }) => id === "copy-collector")?.unlocked,
    true,
  );
  assert.equal(
    achievements.find(({ id }) => id === "card-curator")?.progressPercent,
    100,
  );
  assert.equal(
    achievements.find(({ id }) => id === "cross-game")?.progressPercent,
    67,
  );
  assert.equal(
    achievements.find(({ id }) => id === "set-complete")?.progressPercent,
    25,
  );
});

test("selects the closest locked milestone", () => {
  const achievements = deriveCollectionAchievements({
    cards: [{ tcg: "pokemon", externalId: "card-1", quantity: 40 }],
    binderCount: 1,
    wishlistCount: 0,
  });

  assert.equal(nextCollectionAchievement(achievements)?.id, "copy-collector");
});
