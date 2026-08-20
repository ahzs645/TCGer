ALTER TABLE "Transaction"
ADD COLUMN "collectionEntryId" TEXT,
ADD COLUMN "sourceUrl" TEXT;

CREATE INDEX "Transaction_userId_collectionEntryId_idx"
ON "Transaction"("userId", "collectionEntryId");
