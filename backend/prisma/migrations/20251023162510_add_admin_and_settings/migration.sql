-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "publicDashboard" BOOLEAN NOT NULL DEFAULT false,
    "publicCollections" BOOLEAN NOT NULL DEFAULT false,
    "requireAuth" BOOLEAN NOT NULL DEFAULT true,
    "appName" TEXT NOT NULL DEFAULT 'TCG Manager',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TcgGame" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "apiEndpoint" TEXT,
    "schemaVersion" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TcgGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "tcgGameId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setCode" TEXT,
    "setName" TEXT,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "imageUrlSmall" TEXT,
    "tcgSpecific" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" TEXT,
    "language" TEXT,
    "notes" TEXT,
    "customAttributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" BIGSERIAL NOT NULL,
    "cardId" TEXT NOT NULL,
    "price" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YugiohCard" (
    "cardId" TEXT NOT NULL,
    "cardType" TEXT,
    "monsterType" TEXT,
    "attribute" TEXT,
    "level" INTEGER,
    "atk" INTEGER,
    "def" INTEGER,
    "description" TEXT,
    "archetype" TEXT,

    CONSTRAINT "YugiohCard_pkey" PRIMARY KEY ("cardId")
);

-- CreateTable
CREATE TABLE "MagicCard" (
    "cardId" TEXT NOT NULL,
    "manaCost" TEXT,
    "cmc" INTEGER,
    "cardType" TEXT,
    "colors" TEXT[],
    "oracleText" TEXT,
    "power" TEXT,
    "toughness" TEXT,
    "loyalty" INTEGER,
    "artist" TEXT,
    "foil" BOOLEAN DEFAULT false,
    "edition" TEXT,

    CONSTRAINT "MagicCard_pkey" PRIMARY KEY ("cardId")
);

-- CreateTable
CREATE TABLE "PokemonCard" (
    "cardId" TEXT NOT NULL,
    "pokemonType" TEXT,
    "hp" INTEGER,
    "evolutionStage" TEXT,
    "retreatCost" INTEGER,
    "weakness" TEXT,
    "resistance" TEXT,
    "attacks" JSONB,
    "ability" JSONB,
    "isEx" BOOLEAN DEFAULT false,
    "isGx" BOOLEAN DEFAULT false,
    "isV" BOOLEAN DEFAULT false,
    "firstEdition" BOOLEAN DEFAULT false,
    "holo" BOOLEAN DEFAULT false,

    CONSTRAINT "PokemonCard_pkey" PRIMARY KEY ("cardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TcgGame_code_key" ON "TcgGame"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Card_tcgGameId_externalId_key" ON "Card"("tcgGameId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_userId_cardId_condition_language_key" ON "Collection"("userId", "cardId", "condition", "language");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_tcgGameId_fkey" FOREIGN KEY ("tcgGameId") REFERENCES "TcgGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YugiohCard" ADD CONSTRAINT "YugiohCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicCard" ADD CONSTRAINT "MagicCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PokemonCard" ADD CONSTRAINT "PokemonCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
