import { decode } from 'cborg';

// node-app-attest only needs decodeAllSync. Use a stream-free decoder and
// Wrangler alias so parsing has the same behavior in Node and workerd.
// Reject duplicate keys, trailing objects and indefinite
// lengths. Keep byte strings as Buffers for the verifier's binary operations.
function buffers(value, depth = 0) {
  if (depth > 16) throw new Error('Attestation nesting is too deep');
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(item => buffers(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, buffers(item, depth + 1)]));
  }
  return value;
}

export function decodeAllSync(input) {
  return [buffers(decode(input, {
    strict: true, allowIndefinite: false, allowUndefined: false,
    allowNaN: false, allowInfinity: false, allowBigInt: false,
    rejectDuplicateMapKeys: true,
  }))];
}

export default { decodeAllSync };
