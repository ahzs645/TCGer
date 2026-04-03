CREATE TABLE "CardHash" (
    "id" TEXT NOT NULL,
    "tcg" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setCode" TEXT,
    "setName" TEXT,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "rHash" TEXT NOT NULL,
    "gHash" TEXT NOT NULL,
    "bHash" TEXT NOT NULL,
    "hashSize" INTEGER NOT NULL DEFAULT 16,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardHash_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardHash_tcg_externalId_key" ON "CardHash"("tcg", "externalId");
CREATE INDEX "CardHash_tcg_idx" ON "CardHash"("tcg");
