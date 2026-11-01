export const UNKNOWN_CURRENCY = "UNKNOWN";

/** Legacy numeric costs carry no currency evidence; only an explicit code is usable. */
export function originalCurrency(value?: string | null): string {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : UNKNOWN_CURRENCY;
}

export function inferredSaleCost(
  copy: {
    acquisitionPrice?: number | null;
    acquisitionCurrency?: string | null;
  },
  saleCurrency: string,
): number | undefined {
  const original = originalCurrency(copy.acquisitionCurrency);
  if (
    original === UNKNOWN_CURRENCY ||
    original !== originalCurrency(saleCurrency) ||
    copy.acquisitionPrice == null ||
    !Number.isFinite(copy.acquisitionPrice)
  )
    return undefined;
  return copy.acquisitionPrice;
}
