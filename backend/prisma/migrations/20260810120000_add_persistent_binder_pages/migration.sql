CREATE TABLE "BinderPage" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT,
    "placements" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BinderPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BinderPage_binderId_pageNumber_key"
ON "BinderPage"("binderId", "pageNumber");

CREATE INDEX "BinderPage_binderId_pageNumber_idx"
ON "BinderPage"("binderId", "pageNumber");

ALTER TABLE "BinderPage"
ADD CONSTRAINT "BinderPage_binderId_fkey"
FOREIGN KEY ("binderId") REFERENCES "Binder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
