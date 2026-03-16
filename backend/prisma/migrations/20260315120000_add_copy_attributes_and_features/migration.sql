-- AlterTable: Add copy attributes (foil, signed, altered) and image URLs to Collection
ALTER TABLE "Collection" ADD COLUMN "isFoil" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Collection" ADD COLUMN "isSigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Collection" ADD COLUMN "isAltered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Collection" ADD COLUMN "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: Add default game preference to User
ALTER TABLE "User" ADD COLUMN "defaultGame" TEXT;
