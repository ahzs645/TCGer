CREATE TABLE "SealedOpening" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sealedInventoryId" TEXT NOT NULL,
  "openedQuantity" INTEGER NOT NULL DEFAULT 1,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SealedOpening_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SealedOpenedCard" (
  "id" TEXT NOT NULL,
  "openingId" TEXT NOT NULL,
  "collectionId" TEXT,
  "externalId" TEXT NOT NULL,
  "tcg" TEXT NOT NULL,
  "cardName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "realizedProceeds" DECIMAL(10,2),
  "soldAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SealedOpenedCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SealedOpenedCard_collectionId_key"
ON "SealedOpenedCard"("collectionId");
CREATE INDEX "SealedOpening_userId_openedAt_idx"
ON "SealedOpening"("userId", "openedAt");
CREATE INDEX "SealedOpening_sealedInventoryId_idx"
ON "SealedOpening"("sealedInventoryId");
CREATE INDEX "SealedOpenedCard_openingId_status_idx"
ON "SealedOpenedCard"("openingId", "status");

ALTER TABLE "SealedOpening"
ADD CONSTRAINT "SealedOpening_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SealedOpening"
ADD CONSTRAINT "SealedOpening_sealedInventoryId_fkey"
FOREIGN KEY ("sealedInventoryId") REFERENCES "SealedInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SealedOpenedCard"
ADD CONSTRAINT "SealedOpenedCard_openingId_fkey"
FOREIGN KEY ("openingId") REFERENCES "SealedOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SealedOpenedCard"
ADD CONSTRAINT "SealedOpenedCard_collectionId_fkey"
FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
