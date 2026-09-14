export const MAX_ITEMS = 50;
export const MAX_BODY_BYTES = 32 * 1024;
const dimensions = ['gameId', 'cardId', 'finishCode', 'condition', 'language', 'grader', 'grade'];

export function lookupItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid item');
  if (Object.keys(value).some(key => !dimensions.includes(key))) throw new Error('Unknown item field');
  const item = {};
  for (const key of dimensions) {
    const text = value[key];
    if (text === undefined && key !== 'gameId' && key !== 'cardId') continue;
    if (typeof text !== 'string' || !text.trim() || text.length > (key === 'cardId' ? 240 : 80) || /[\u0000-\u001f]/.test(text)) {
      throw new Error(`Invalid ${key}`);
    }
    item[key] = text.trim();
  }
  if (!/^[a-z0-9-]+$/.test(item.gameId)) throw new Error('Invalid gameId');
  if (Boolean(item.grader) !== Boolean(item.grade)) throw new Error('Grader and grade must be provided together');
  return item;
}

export function lookupKey(item) {
  // Absent dimensions mean unspecified, never any finish/condition/language.
  return JSON.stringify(dimensions.map(key => item[key] ?? null));
}

export function lookupRequest(value) {
  if (!value || Object.keys(value).some(key => key !== 'items') || !Array.isArray(value.items) ||
      value.items.length < 1 || value.items.length > MAX_ITEMS) throw new Error('Expected 1–50 items');
  return value.items.map(lookupItem);
}

export function positiveLimit(value, maximum) {
  if (!/^\d+$/.test(String(value))) throw new Error('Invalid quota configuration');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error('Invalid quota configuration');
  return number;
}

export function validateSnapshot(value, now = Date.now()) {
  if (value?.schema !== 'tcger-hosted-prices-v1' || !Array.isArray(value.quotes) ||
      value.quotes.length < 1 || value.quotes.length > 1_000_000) throw new Error('Invalid price snapshot');
  const seen = new Set();
  const perKey = new Map();
  return value.quotes.map(quote => {
    const item = lookupItem(Object.fromEntries(dimensions.filter(key => quote[key] !== undefined).map(key => [key, quote[key]])));
    if (!Number.isFinite(quote.amount) || quote.amount <= 0 || !/^[A-Z]{3}$/.test(quote.currency) ||
        typeof quote.source !== 'string' || !quote.source.trim() || quote.source.length > 80 ||
        typeof quote.providerProductId !== 'string' || !quote.providerProductId || quote.providerProductId.length > 240) {
      throw new Error('Invalid quote amount or provenance');
    }
    const observed = Date.parse(quote.observedAt), retrieved = Date.parse(quote.retrievedAt), expires = Date.parse(quote.expiresAt);
    if (![observed, retrieved, expires].every(Number.isFinite) || observed > retrieved || retrieved > now || expires <= observed) {
      throw new Error('Invalid quote timestamps');
    }
    const key = lookupKey(item);
    const identity = JSON.stringify([key, quote.source, quote.currency]);
    if (seen.has(identity)) throw new Error('Duplicate quote');
    seen.add(identity);
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
    if (perKey.get(key) > 8) throw new Error('More than eight quotes for one lookup');
    return {
      ...item, amount: quote.amount, currency: quote.currency, source: quote.source,
      providerProductId: quote.providerProductId,
      observedAt: new Date(observed).toISOString(), retrievedAt: new Date(retrieved).toISOString(),
      expiresAt: new Date(expires).toISOString(),
    };
  });
}
