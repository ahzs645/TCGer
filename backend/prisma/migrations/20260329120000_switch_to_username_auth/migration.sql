-- Switch auth from email-based to username-based login
-- 1. Make username required: backfill any NULL usernames from email (local part)
UPDATE "User" SET "username" = SPLIT_PART("email", '@', 1) WHERE "username" IS NULL;

-- 2. Ensure no duplicate usernames after backfill (append suffix if needed)
UPDATE "User" u SET "username" = u."username" || '_' || SUBSTRING(u."id", 1, 4)
WHERE (SELECT COUNT(*) FROM "User" u2 WHERE u2."username" = u."username") > 1;

-- 3. Make username NOT NULL and add unique constraint
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- 4. Make email optional (drop NOT NULL)
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- 5. Keep email unique index but only for non-null values (partial unique)
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email") WHERE "email" IS NOT NULL;
