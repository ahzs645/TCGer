ALTER TABLE "SealedProduct" ADD COLUMN "ownerId" TEXT;

CREATE INDEX "SealedProduct_ownerId_idx" ON "SealedProduct"("ownerId");
CREATE INDEX "SealedProduct_ownerId_tcg_releaseDate_idx"
  ON "SealedProduct"("ownerId", "tcg", "releaseDate");

ALTER TABLE "SealedProduct"
  ADD CONSTRAINT "SealedProduct_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
