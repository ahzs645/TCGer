ALTER TABLE "WishlistCard"
  ADD COLUMN "desiredQuantity" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "WishlistCard"
  ADD CONSTRAINT "WishlistCard_desiredQuantity_check"
  CHECK ("desiredQuantity" BETWEEN 1 AND 99);
