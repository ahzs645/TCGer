import { canonicalizeYugiohSetCode } from './yugioh-set-code';

const KEY_PREFIX = 'yugioh:print:v1:';

export interface YugiohPrintingIdentity {
  baseExternalId: string;
  setCode?: string;
  rarity?: string;
  artworkId?: string;
}

export function buildYugiohPrintingKey(identity: YugiohPrintingIdentity): string {
  const parts = [
    identity.baseExternalId.trim(),
    identity.setCode ? canonicalizeYugiohSetCode(identity.setCode) : '',
    normalizeRarity(identity.rarity),
    identity.artworkId?.trim() ?? ''
  ];
  return `${KEY_PREFIX}${parts.map((part) => encodeURIComponent(part)).join(':')}`;
}

export function parseYugiohPrintingKey(value: string): YugiohPrintingIdentity | null {
  if (!value.startsWith(KEY_PREFIX)) {
    return null;
  }

  const encodedParts = value.slice(KEY_PREFIX.length).split(':');
  if (encodedParts.length !== 4) {
    return null;
  }

  try {
    const [baseExternalId, setCode, rarity, artworkId] = encodedParts.map((part) =>
      decodeURIComponent(part)
    );
    if (!baseExternalId) {
      return null;
    }
    return {
      baseExternalId,
      ...(setCode ? { setCode } : {}),
      ...(rarity ? { rarity } : {}),
      ...(artworkId ? { artworkId } : {})
    };
  } catch {
    return null;
  }
}

export function normalizeYugiohRarity(rarity?: string): string {
  return normalizeRarity(rarity);
}

function normalizeRarity(rarity?: string): string {
  return rarity?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
}
