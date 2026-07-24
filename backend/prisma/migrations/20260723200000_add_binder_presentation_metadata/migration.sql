ALTER TABLE "Binder"
  ADD COLUMN "containerType" TEXT,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "associatedTcg" TEXT,
  ADD COLUMN "associatedSetCode" TEXT,
  ADD COLUMN "associatedSetName" TEXT;

CREATE INDEX "Binder_userId_containerType_idx"
  ON "Binder"("userId", "containerType");

CREATE INDEX "Binder_userId_associatedTcg_associatedSetCode_idx"
  ON "Binder"("userId", "associatedTcg", "associatedSetCode");
