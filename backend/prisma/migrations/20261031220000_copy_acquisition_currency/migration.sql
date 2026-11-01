-- Keep legacy unknown currency explicit; there is no defensible automatic FX conversion.
ALTER TABLE "Collection" ADD COLUMN "acquisitionCurrency" TEXT;
