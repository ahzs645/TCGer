-- AlterTable
ALTER TABLE "User" ADD COLUMN "enabledOnepiece" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "enabledLorcana" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "enabledDragonball" BOOLEAN NOT NULL DEFAULT true;

-- Seed new TCG games
INSERT INTO "TcgGame" ("code", "displayName", "enabled", "createdAt", "updatedAt")
VALUES
  ('onepiece', 'One Piece Card Game', true, NOW(), NOW()),
  ('lorcana', 'Disney Lorcana', true, NOW(), NOW()),
  ('dragonball', 'Dragon Ball Super Card Game', true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
