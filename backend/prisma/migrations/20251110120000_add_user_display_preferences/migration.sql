-- AlterTable
ALTER TABLE "User"
ADD COLUMN "showCardNumbers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showPricing" BOOLEAN NOT NULL DEFAULT true;

-- Backfill existing users to ensure defaults are set
UPDATE "User"
SET "showCardNumbers" = COALESCE("showCardNumbers", true),
    "showPricing" = COALESCE("showPricing", true);
