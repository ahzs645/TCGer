-- CreateTable
CREATE TABLE "Binder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "colorHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Binder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Binder_userId_name_key" ON "Binder"("userId", "name");

-- AddForeignKey
ALTER TABLE "Binder" ADD CONSTRAINT "Binder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Add binder, price, and acquisition columns to Collection
ALTER TABLE "Collection" ADD COLUMN "binderId" TEXT;
ALTER TABLE "Collection" ADD COLUMN "price" DECIMAL(10,2);
ALTER TABLE "Collection" ADD COLUMN "acquisitionPrice" DECIMAL(10,2);

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "Binder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Update uniqueness constraint to include binderId
ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_userId_cardId_condition_language_key";
CREATE UNIQUE INDEX "Collection_userId_cardId_binderId_condition_language_key" ON "Collection"("userId", "cardId", "binderId", "condition", "language");
