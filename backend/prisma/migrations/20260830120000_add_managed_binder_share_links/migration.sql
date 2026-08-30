CREATE TABLE "BinderShareLink" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BinderShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BinderShareLink_token_key" ON "BinderShareLink"("token");
CREATE INDEX "BinderShareLink_binderId_createdAt_idx" ON "BinderShareLink"("binderId", "createdAt");
ALTER TABLE "BinderShareLink" ADD CONSTRAINT "BinderShareLink_binderId_fkey"
  FOREIGN KEY ("binderId") REFERENCES "Binder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BinderShareLink" ("id", "binderId", "label", "token", "createdAt")
SELECT 'legacy-' || md5("id" || ':' || "shareToken"), "id", 'Original link', "shareToken", "createdAt"
FROM "Binder"
WHERE "isPublic" = true AND "shareToken" IS NOT NULL;
