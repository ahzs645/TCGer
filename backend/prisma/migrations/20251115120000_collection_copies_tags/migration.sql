-- Remove legacy uniqueness constraint so multiple copies of the same card can be stored
ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_userId_cardId_binderId_condition_language_key";

-- Add per-copy metadata columns
ALTER TABLE "Collection"
  ADD COLUMN IF NOT EXISTS "serialNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "acquiredAt" TIMESTAMP(3);

-- Fan out quantity > 1 rows into individual copies
INSERT INTO "Collection" (
  "id",
  "userId",
  "cardId",
  "binderId",
  "quantity",
  "condition",
  "language",
  "notes",
  "price",
  "acquisitionPrice",
  "customAttributes",
  "serialNumber",
  "acquiredAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  "userId",
  "cardId",
  "binderId",
  1,
  "condition",
  "language",
  "notes",
  "price",
  "acquisitionPrice",
  "customAttributes",
  NULL,
  NULL,
  "createdAt",
  "updatedAt"
FROM "Collection"
CROSS JOIN generate_series(1, GREATEST("Collection"."quantity" - 1, 0)) AS copy_index
WHERE "Collection"."quantity" > 1;

UPDATE "Collection" SET "quantity" = 1 WHERE "quantity" > 1;

-- Tag tables
CREATE TABLE IF NOT EXISTS "Tag" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "colorHex" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Tag_user_label_unique" UNIQUE ("userId", "label")
);

CREATE TABLE IF NOT EXISTS "CollectionTag" (
  "collectionId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionTag_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE,
  CONSTRAINT "CollectionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE,
  CONSTRAINT "CollectionTag_pkey" PRIMARY KEY ("collectionId", "tagId")
);
