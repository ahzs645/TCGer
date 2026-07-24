ALTER TABLE "PriceHistory"
ADD COLUMN "finishCode" TEXT;

CREATE INDEX "PriceHistory_cardId_finishCode_recordedAt_idx"
ON "PriceHistory"("cardId", "finishCode", "recordedAt");
