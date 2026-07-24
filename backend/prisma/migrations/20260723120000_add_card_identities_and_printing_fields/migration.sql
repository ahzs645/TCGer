-- Additive card identity -> printing foundation. Existing "Card" rows remain
-- valid and can be linked/backfilled incrementally.
CREATE TABLE "CardIdentity" (
    "id" TEXT NOT NULL,
    "tcgGameId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tcgSpecific" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardIdentity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Card"
    ADD COLUMN "identityId" TEXT,
    ADD COLUMN "baseExternalId" TEXT,
    ADD COLUMN "printingKey" TEXT,
    ADD COLUMN "artworkId" TEXT,
    ADD COLUMN "collectorNumber" TEXT;

CREATE UNIQUE INDEX "CardIdentity_tcgGameId_externalId_key"
    ON "CardIdentity"("tcgGameId", "externalId");
CREATE INDEX "CardIdentity_name_idx" ON "CardIdentity"("name");
CREATE UNIQUE INDEX "Card_printingKey_key" ON "Card"("printingKey");
CREATE INDEX "Card_identityId_idx" ON "Card"("identityId");
CREATE INDEX "Card_tcgGameId_baseExternalId_idx"
    ON "Card"("tcgGameId", "baseExternalId");
CREATE INDEX "Card_tcgGameId_setCode_idx" ON "Card"("tcgGameId", "setCode");

ALTER TABLE "CardIdentity"
    ADD CONSTRAINT "CardIdentity_tcgGameId_fkey"
    FOREIGN KEY ("tcgGameId") REFERENCES "TcgGame"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Card"
    ADD CONSTRAINT "Card_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "CardIdentity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
