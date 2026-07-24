ALTER TABLE "DeckCard" ADD COLUMN "zone" TEXT NOT NULL DEFAULT 'main';

UPDATE "DeckCard"
SET "zone" = 'side'
WHERE "isSideboard" = true;

DROP INDEX "DeckCard_deckId_externalId_isSideboard_key";

CREATE UNIQUE INDEX "DeckCard_deckId_externalId_zone_key"
ON "DeckCard"("deckId", "externalId", "zone");
