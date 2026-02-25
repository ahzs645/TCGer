-- CreateTable
CREATE TABLE "Wishlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "colorHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistCard" (
    "id" TEXT NOT NULL,
    "wishlistId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "tcg" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setCode" TEXT,
    "setName" TEXT,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "imageUrlSmall" TEXT,
    "setSymbolUrl" TEXT,
    "setLogoUrl" TEXT,
    "collectorNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_userId_name_key" ON "Wishlist"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistCard_wishlistId_externalId_tcg_key" ON "WishlistCard"("wishlistId", "externalId", "tcg");

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistCard" ADD CONSTRAINT "WishlistCard_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "Wishlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
