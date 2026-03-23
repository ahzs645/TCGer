-- Add columns that were in the Prisma schema but missing from migrations
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "discordId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "defaultGame" TEXT;
