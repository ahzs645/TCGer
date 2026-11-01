-- Restore the legacy domain foundations omitted from historical migrations.
-- This file intentionally precedes the July ALTER migrations that depend on
-- DeckCard, SealedProduct, SealedInventory, and Transaction. Already-existing
-- tables are left intact: older installations often created them with db push.
-- No historical migration is rewritten and no stored data is discarded.

DO $tcger$
BEGIN
  IF to_regclass('"NotificationChannel"') IS NULL THEN
    CREATE TABLE "NotificationChannel" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "config" JSONB NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"Notification"') IS NULL THEN
    CREATE TABLE "Notification" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "read" BOOLEAN NOT NULL DEFAULT false,
        "data" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"Deck"') IS NULL THEN
    CREATE TABLE "Deck" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "tcg" TEXT NOT NULL,
        "format" TEXT,
        "colorHex" TEXT,
        "isPublic" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "Deck_userId_name_key" ON "Deck"("userId", "name");

    ALTER TABLE "Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"DeckCard"') IS NULL THEN
    CREATE TABLE "DeckCard" (
        "id" TEXT NOT NULL,
        "deckId" TEXT NOT NULL,
        "externalId" TEXT NOT NULL,
        "tcg" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "isCommander" BOOLEAN NOT NULL DEFAULT false,
        "isSideboard" BOOLEAN NOT NULL DEFAULT false,
        "imageUrl" TEXT,
        "imageUrlSmall" TEXT,
        "setCode" TEXT,
        "setName" TEXT,
        "cardData" JSONB,

        CONSTRAINT "DeckCard_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "DeckCard_deckId_externalId_isSideboard_key" ON "DeckCard"("deckId", "externalId", "isSideboard");

    ALTER TABLE "DeckCard" ADD CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"SealedProduct"') IS NULL THEN
    CREATE TABLE "SealedProduct" (
        "id" TEXT NOT NULL,
        "tcg" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "productType" TEXT NOT NULL,
        "setCode" TEXT,
        "cardsPerPack" INTEGER,
        "packsPerBox" INTEGER,
        "releaseDate" TIMESTAMP(3),
        "imageUrl" TEXT,
        "msrp" DECIMAL(10,2),
        "upc" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "SealedProduct_pkey" PRIMARY KEY ("id")
    );
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"SealedInventory"') IS NULL THEN
    CREATE TABLE "SealedInventory" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "purchasePrice" DECIMAL(10,2),
        "purchaseDate" TIMESTAMP(3),
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "SealedInventory_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "SealedInventory" ADD CONSTRAINT "SealedInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "SealedInventory" ADD CONSTRAINT "SealedInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SealedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"PriceAlert"') IS NULL THEN
    CREATE TABLE "PriceAlert" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "cardId" TEXT,
        "externalId" TEXT NOT NULL,
        "tcg" TEXT NOT NULL,
        "cardName" TEXT NOT NULL,
        "imageUrl" TEXT,
        "targetPrice" DECIMAL(10,2) NOT NULL,
        "direction" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "lastTriggered" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"Transaction"') IS NULL THEN
    CREATE TABLE "Transaction" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "cardId" TEXT,
        "externalId" TEXT,
        "tcg" TEXT,
        "cardName" TEXT,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "amount" DECIMAL(10,2) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'USD',
        "platform" TEXT,
        "notes" TEXT,
        "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"ShopConnection"') IS NULL THEN
    CREATE TABLE "ShopConnection" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "platform" TEXT NOT NULL,
        "apiKey" TEXT NOT NULL,
        "apiSecret" TEXT,
        "sellerId" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "lastSync" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "ShopConnection_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "ShopConnection" ADD CONSTRAINT "ShopConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"Trade"') IS NULL THEN
    CREATE TABLE "Trade" (
        "id" TEXT NOT NULL,
        "senderId" TEXT NOT NULL,
        "receiverId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "message" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "Trade" ADD CONSTRAINT "Trade_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "Trade" ADD CONSTRAINT "Trade_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"TradeCard"') IS NULL THEN
    CREATE TABLE "TradeCard" (
        "id" TEXT NOT NULL,
        "tradeId" TEXT NOT NULL,
        "side" TEXT NOT NULL,
        "externalId" TEXT NOT NULL,
        "tcg" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "imageUrl" TEXT,
        "estimatedValue" DECIMAL(10,2),

        CONSTRAINT "TradeCard_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "TradeCard" ADD CONSTRAINT "TradeCard_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"Automation"') IS NULL THEN
    CREATE TABLE "Automation" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "trigger" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "config" JSONB NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "Automation" ADD CONSTRAINT "Automation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

DO $tcger$
BEGIN
  IF to_regclass('"Shipment"') IS NULL THEN
    CREATE TABLE "Shipment" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "carrier" TEXT NOT NULL,
        "trackingNumber" TEXT NOT NULL,
        "status" TEXT,
        "description" TEXT,
        "relatedTradeId" TEXT,
        "lastChecked" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$tcger$;

-- Other schema changes historically made only by db push. These are additive
-- or relax obsolete constraints; retained credentials are never dropped.
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "scrydexApiBaseUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "scrydexApiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "scrydexTeamId" TEXT,
  ADD COLUMN IF NOT EXISTS "scryfallApiBaseUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "tcgdexApiBaseUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "ygoApiBaseUrl" TEXT;
ALTER TABLE "Binder"
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Binder_shareToken_key" ON "Binder"("shareToken");
ALTER TABLE "Collection"
  ADD COLUMN IF NOT EXISTS "certNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "gradingCompany" TEXT,
  ADD COLUMN IF NOT EXISTS "gradingScore" TEXT;
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "enabledMagic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "enabledPokemon" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "enabledYugioh" BOOLEAN NOT NULL DEFAULT true;
DO $tcger$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'passwordHash') THEN
    ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
  END IF;
END
$tcger$;

-- Prisma created these as standalone indexes. DROP CONSTRAINT alone in the
-- original physical-copy migration did not remove them on fresh databases.
ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_userId_cardId_binderId_condition_language_key";
ALTER TABLE "Collection" DROP CONSTRAINT IF EXISTS "Collection_userId_cardId_condition_language_key";
DROP INDEX IF EXISTS "Collection_userId_cardId_binderId_condition_language_key";
DROP INDEX IF EXISTS "Collection_userId_cardId_condition_language_key";
ALTER TABLE "Binder" DROP CONSTRAINT IF EXISTS "Binder_userId_name_key";
DROP INDEX IF EXISTS "Binder_userId_name_key";
