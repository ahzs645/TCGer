/**
 * Runtime-independent entity ids.
 *
 * A Convex `_id` can only be minted by Convex. That is fine while the hosted
 * runtime is the only one that creates rows, and it stops being fine the moment
 * the local runtime does — an offline-created row has no identity that can
 * survive being promoted to the hosted database, so promotion would have to
 * re-mint every id and rewrite every reference to it. societyer carries an
 * `ids.ts` for exactly this reason, and its header is a warning about
 * retrofitting identity after the fact rather than before.
 *
 * TCGer has no promotion feature today. This exists so that when one is built,
 * the rows already created locally are usable as-is.
 *
 * ## Shape
 *
 * Crockford base32, 26 characters, ULID-like: 10 characters of millisecond
 * timestamp followed by 16 of entropy. Two properties earn that layout:
 *
 * - **Lexicographically sortable by creation time.** `_creationTime` is a
 *   separate field, but an id that sorts the same way means a stable order
 *   survives anywhere the timestamp does not travel — and the collection
 *   projection depends on a stable oldest-first order to decide which copy's id
 *   becomes the card's id.
 * - **Collision-free without coordination.** Ids are minted on a phone, in a
 *   browser tab, and on a desktop app that have never spoken to each other. A
 *   per-millisecond counter covers the rapid-fire case that randomness alone
 *   handles poorly (a loop adding 200 copies), and randomness covers the case
 *   two runtimes mint in the same millisecond.
 */

/** Crockford base32: no I, L, O or U, so ids cannot be misread aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const ENTROPY_LENGTH = 16;

export const ENTITY_ID_LENGTH = TIME_LENGTH + ENTROPY_LENGTH;

let lastTimestamp = -1;
let counter = 0;

function encode(value: number, length: number): string {
  let out = "";
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    out = ALPHABET[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomChars(length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[Math.floor(Math.random() * 32)];
  }
  return out;
}

/**
 * Mint an id. Monotonic within a millisecond, so ids minted in a tight loop
 * still sort in creation order.
 */
export function entityId(now: number = Date.now()): string {
  if (now === lastTimestamp) {
    counter += 1;
  } else {
    lastTimestamp = now;
    counter = 0;
  }
  // The counter occupies the high entropy characters so it dominates the sort
  // within a millisecond; the rest stays random for cross-runtime uniqueness.
  return (
    encode(now, TIME_LENGTH) +
    encode(counter, 4) +
    randomChars(ENTROPY_LENGTH - 4)
  );
}

/** Is this a well-formed entity id? Shape only — says nothing about existence. */
export function isEntityId(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== ENTITY_ID_LENGTH) {
    return false;
  }
  for (const character of value) {
    if (!ALPHABET.includes(character)) return false;
  }
  return true;
}

/** The millisecond an id was minted at, or `null` if it is not one of ours. */
export function entityIdTimestamp(value: string): number | null {
  if (!isEntityId(value)) return null;
  let time = 0;
  for (const character of value.slice(0, TIME_LENGTH)) {
    time = time * 32 + ALPHABET.indexOf(character);
  }
  return time;
}
