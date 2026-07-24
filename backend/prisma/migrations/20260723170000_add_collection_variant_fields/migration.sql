ALTER TABLE "Collection"
  ADD COLUMN "finishCode" TEXT,
  ADD COLUMN "finishLabel" TEXT,
  ADD COLUMN "edition" TEXT,
  ADD COLUMN "stamp" TEXT,
  ADD COLUMN "isSealedPromo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isOversized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isPeelOff" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "storageLocation" TEXT;

ALTER TABLE "WishlistCard"
  ADD COLUMN "tcgSpecific" JSONB;
