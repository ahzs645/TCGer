CREATE TABLE "CollectionMutationAudit" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKind" TEXT NOT NULL,
    "binderId" TEXT,
    "cardName" TEXT,
    "affectedCopies" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "beforeState" JSONB NOT NULL,
    "afterState" JSONB NOT NULL,
    "metadata" JSONB,
    "sourceAuditId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionMutationAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CollectionMutationAudit_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CollectionMutationAudit_sourceAuditId_key"
  ON "CollectionMutationAudit"("sourceAuditId");
CREATE UNIQUE INDEX "CollectionMutationAudit_userId_idempotencyKey_key"
  ON "CollectionMutationAudit"("userId", "idempotencyKey");
CREATE INDEX "CollectionMutationAudit_userId_createdAt_idx"
  ON "CollectionMutationAudit"("userId", "createdAt");
CREATE INDEX "CollectionMutationAudit_userId_operationKind_createdAt_idx"
  ON "CollectionMutationAudit"("userId", "operationKind", "createdAt");
