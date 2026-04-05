CREATE TABLE "CardScanDebugCapture" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedTcg" TEXT,
    "captureSource" TEXT,
    "sourceImagePath" TEXT NOT NULL,
    "sourceFilename" TEXT,
    "sourceMimeType" TEXT,
    "sourceImageWidth" INTEGER,
    "sourceImageHeight" INTEGER,
    "bestMatchExternalId" TEXT,
    "bestMatchName" TEXT,
    "bestMatchTcg" TEXT,
    "bestMatchConfidence" DOUBLE PRECISION,
    "bestMatchDistance" INTEGER,
    "feedbackStatus" TEXT NOT NULL DEFAULT 'unreviewed',
    "notes" TEXT,
    "expectedExternalId" TEXT,
    "expectedName" TEXT,
    "expectedTcg" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "debugPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardScanDebugCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CardScanDebugCapture_userId_createdAt_idx" ON "CardScanDebugCapture"("userId", "createdAt");
CREATE INDEX "CardScanDebugCapture_feedbackStatus_createdAt_idx" ON "CardScanDebugCapture"("feedbackStatus", "createdAt");

ALTER TABLE "CardScanDebugCapture"
ADD CONSTRAINT "CardScanDebugCapture_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
