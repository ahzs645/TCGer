-- CreateTable
CREATE TABLE "WishlistRule" (
    "id" TEXT NOT NULL,
    "wishlistId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tcg" TEXT,
    "query" TEXT,
    "setCode" TEXT,
    "setName" TEXT,
    "includeAllPrintings" BOOLEAN NOT NULL DEFAULT true,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastMatchCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WishlistRule_wishlistId_idx" ON "WishlistRule"("wishlistId");

-- AddForeignKey
ALTER TABLE "WishlistRule" ADD CONSTRAINT "WishlistRule_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "Wishlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
