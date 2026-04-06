ALTER TABLE "CardScanDebugCapture"
ADD COLUMN "correctedImagePath" TEXT,
ADD COLUMN "artworkImagePath" TEXT,
ADD COLUMN "titleImagePath" TEXT,
ADD COLUMN "footerImagePath" TEXT,
ADD COLUMN "reviewTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
