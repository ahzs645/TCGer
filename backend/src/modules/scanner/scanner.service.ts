// ---------------------------------------------------------------------------
// Card Scanner / Image Recognition Service (Web)
// ---------------------------------------------------------------------------

export interface ScanResult {
  matched: boolean;
  confidence: number;
  card?: {
    externalId: string;
    tcg: string;
    name: string;
    setCode?: string;
    imageUrl?: string;
  };
}

/**
 * Identify a card from an uploaded image.
 * In production, this would use perceptual hashing or ML-based image recognition.
 * For now, it provides the infrastructure/endpoint for the feature.
 */
export async function identifyCardFromImage(_imageBuffer: Buffer): Promise<ScanResult[]> {
  // TODO: Implement image recognition using perceptual hashing
  // 1. Convert image to hash using pHash
  // 2. Compare against cached card image hashes
  // 3. Return top matches by hamming distance
  return [{
    matched: false,
    confidence: 0,
    card: undefined
  }];
}

/**
 * Look up a product by barcode (UPC/EAN)
 */
export async function lookupBarcode(_barcode: string): Promise<{ found: boolean; product?: { name: string; tcg: string; type: string } }> {
  // TODO: Implement UPC lookup against SealedProduct table
  return { found: false };
}
