import { z } from 'zod';

import { TCG_CODES, tcgCodeSchema, type TcgCode } from './cards';
import type { GameFilterSelection } from './game-packages';

const collectionPropertyPath = z
  .string()
  .min(1)
  .max(96)
  .regex(
    /^(name|setCode|setName|collectorNumber|rarity|releasedAt|language|artist|supertype|regulationMark|sanctionedPlayLegal|quantity|dexEntries\.number|formatLegality\.(standard|expanded|unlimited)|attributes\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*|copies\.(condition|language|finishCode|finishLabel|edition|stamp))$/,
    'Property is not available to collection facets',
  );

const collectionFacetBase = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1).max(80),
  property: collectionPropertyPath,
  help: z.string().max(240).optional(),
}).strict();

const facetOption = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().min(1).max(80),
}).strict();

export const collectionFacetSchema = z.discriminatedUnion('type', [
  collectionFacetBase.extend({
    type: z.literal('select'),
    options: z.array(facetOption).max(200).optional(),
  }),
  collectionFacetBase.extend({
    type: z.literal('multiSelect'),
    options: z.array(facetOption).max(200).optional(),
  }),
  collectionFacetBase.extend({
    type: z.literal('numberRange'),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().finite().optional(),
  }),
  collectionFacetBase.extend({
    type: z.literal('boolean'),
    trueLabel: z.string().min(1).max(80).optional(),
    falseLabel: z.string().min(1).max(80).optional(),
  }),
  collectionFacetBase.extend({
    type: z.literal('text'),
    mode: z.enum(['contains', 'equals']).default('contains'),
    maxLength: z.number().int().positive().max(200).default(80),
  }),
]);

export const collectionIdentityModeSchema = z.object({
  id: z.enum(['consolidated', 'collector']),
  label: z.string().min(1).max(40),
  description: z.string().min(1).max(200),
  key: z.enum(['baseExternalId', 'printingKey']),
}).strict();

export const gameDefinitionSchema = z.object({
  id: tcgCodeSchema,
  label: z.string().min(1).max(80),
  collection: z.object({
    identityModes: z.array(collectionIdentityModeSchema).min(1).max(2),
    defaultIdentityMode: z.enum(['consolidated', 'collector']),
    facets: z.array(collectionFacetSchema).max(24),
  }).strict(),
  search: z.object({
    facets: z.array(collectionFacetSchema).max(24),
  }).strict(),
}).strict();

export type CollectionFacet = z.infer<typeof collectionFacetSchema>;
export type CollectionIdentityMode = z.infer<typeof collectionIdentityModeSchema>;
export type GameDefinition = z.infer<typeof gameDefinitionSchema>;

export interface CollectionFacetCard {
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  releasedAt?: string;
  language?: string;
  quantity: number;
  attributes?: Record<string, unknown>;
  copies?: Array<{
    condition?: string;
    language?: string;
    finishCode?: string;
    finishLabel?: string;
    edition?: string;
    stamp?: string;
  }>;
}

const identityModes: CollectionIdentityMode[] = [
  {
    id: 'consolidated',
    label: 'Consolidated',
    description: 'Group every printing by the underlying card identity.',
    key: 'baseExternalId',
  },
  {
    id: 'collector',
    label: 'Collector',
    description: 'Keep exact sets, rarities, artwork, and variants separate.',
    key: 'printingKey',
  },
];

const physicalFacets: CollectionFacet[] = [
  { id: 'language', label: 'Language', property: 'copies.language', type: 'multiSelect' },
  { id: 'edition', label: 'Edition', property: 'copies.edition', type: 'multiSelect' },
  { id: 'owned-quantity', label: 'Owned quantity', property: 'quantity', type: 'numberRange', min: 0, max: 999, step: 1 },
];

const commonSearchFacets: CollectionFacet[] = [
  { id: 'set', label: 'Set', property: 'setName', type: 'multiSelect' },
  { id: 'rarity', label: 'Rarity', property: 'rarity', type: 'multiSelect' },
  { id: 'artist', label: 'Artist / illustrator', property: 'artist', type: 'text', mode: 'contains', maxLength: 80 },
  { id: 'language', label: 'Language', property: 'language', type: 'multiSelect' },
];

const definitions: Record<TcgCode, GameDefinition> = {
  yugioh: {
    id: 'yugioh',
    label: 'Yu-Gi-Oh!',
    search: { facets: [
      ...commonSearchFacets,
      { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
      { id: 'attribute', label: 'Attribute', property: 'attributes.attribute', type: 'multiSelect' },
      { id: 'race', label: 'Monster type', property: 'attributes.race', type: 'multiSelect' },
      { id: 'level', label: 'Level / Rank / Link', property: 'attributes.level', type: 'numberRange', min: 0, max: 13, step: 1 },
      { id: 'atk', label: 'ATK', property: 'attributes.atk', type: 'numberRange', min: 0, max: 99999, step: 100 },
      { id: 'def', label: 'DEF', property: 'attributes.def', type: 'numberRange', min: 0, max: 99999, step: 100 },
      { id: 'rules', label: 'Card text', property: 'attributes.desc', type: 'text', mode: 'contains', maxLength: 160 },
    ] },
    collection: {
      identityModes,
      defaultIdentityMode: 'collector',
      facets: [
        { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
        { id: 'attribute', label: 'Attribute', property: 'attributes.attribute', type: 'multiSelect', options: ['DARK', 'DIVINE', 'EARTH', 'FIRE', 'LIGHT', 'WATER', 'WIND'].map((value) => ({ value, label: value })) },
        { id: 'race', label: 'Race', property: 'attributes.race', type: 'multiSelect' },
        { id: 'level', label: 'Level / Rank / Link', property: 'attributes.level', type: 'numberRange', min: 0, max: 13, step: 1 },
        { id: 'archetype', label: 'Archetype', property: 'attributes.archetype', type: 'text', mode: 'contains', maxLength: 80 },
        { id: 'atk', label: 'ATK', property: 'attributes.atk', type: 'numberRange', min: 0, max: 99999, step: 100 },
        { id: 'def', label: 'DEF', property: 'attributes.def', type: 'numberRange', min: 0, max: 99999, step: 100 },
        ...physicalFacets,
      ],
    },
  },
  magic: {
    id: 'magic',
    label: 'Magic: The Gathering',
    search: { facets: [
      ...commonSearchFacets,
      { id: 'colors', label: 'Colors', property: 'attributes.colors', type: 'multiSelect' },
      { id: 'type-line', label: 'Type line', property: 'attributes.type_line', type: 'text', mode: 'contains', maxLength: 100 },
      { id: 'rules', label: 'Rules text', property: 'attributes.oracle_text', type: 'text', mode: 'contains', maxLength: 160 },
      { id: 'mana-value', label: 'Mana value', property: 'attributes.cmc', type: 'numberRange', min: 0, max: 30, step: 1 },
      { id: 'power', label: 'Power', property: 'attributes.power', type: 'numberRange', min: -10, max: 99, step: 1 },
      { id: 'toughness', label: 'Toughness', property: 'attributes.toughness', type: 'numberRange', min: -10, max: 99, step: 1 },
      { id: 'reserved', label: 'Reserved List', property: 'attributes.reserved', type: 'boolean' },
      { id: 'full-art', label: 'Full art', property: 'attributes.full_art', type: 'boolean' },
    ] },
    collection: {
      identityModes,
      defaultIdentityMode: 'collector',
      facets: [
        { id: 'colors', label: 'Colors', property: 'attributes.colors', type: 'multiSelect', options: ['W', 'U', 'B', 'R', 'G'].map((value) => ({ value, label: value })) },
        { id: 'type-line', label: 'Type line', property: 'attributes.type_line', type: 'text', mode: 'contains', maxLength: 100 },
        { id: 'mana-cost', label: 'Mana cost', property: 'attributes.mana_cost', type: 'text', mode: 'contains', maxLength: 80 },
        { id: 'artist', label: 'Artist', property: 'attributes.artist', type: 'text', mode: 'contains', maxLength: 80 },
        ...physicalFacets,
      ],
    },
  },
  pokemon: {
    id: 'pokemon',
    label: 'Pokémon',
    search: { facets: [
      ...commonSearchFacets,
      { id: 'category', label: 'Category', property: 'supertype', type: 'multiSelect' },
      { id: 'types', label: 'Energy type', property: 'attributes.types', type: 'multiSelect' },
      { id: 'hp', label: 'HP', property: 'attributes.hp', type: 'numberRange', min: 0, max: 1000, step: 10 },
      { id: 'pokedex', label: 'Pokédex number', property: 'dexEntries.number', type: 'numberRange', min: 1, max: 2000, step: 1 },
      { id: 'regulation', label: 'Regulation mark', property: 'regulationMark', type: 'multiSelect' },
      { id: 'standard', label: 'Standard legal', property: 'formatLegality.standard', type: 'boolean' },
    ] },
    collection: {
      identityModes,
      defaultIdentityMode: 'collector',
      facets: [
        { id: 'types', label: 'Types', property: 'attributes.types', type: 'multiSelect' },
        { id: 'hp', label: 'HP', property: 'attributes.hp', type: 'numberRange', min: 0, max: 1000, step: 10 },
        { id: 'artist', label: 'Illustrator', property: 'attributes.artist', type: 'text', mode: 'contains', maxLength: 80 },
        { id: 'finish', label: 'Finish', property: 'copies.finishLabel', type: 'multiSelect' },
        ...physicalFacets,
      ],
    },
  },
  onepiece: {
    id: 'onepiece',
    label: 'One Piece',
    search: { facets: [
      ...commonSearchFacets,
      { id: 'color', label: 'Color', property: 'attributes.color', type: 'multiSelect' },
      { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
      { id: 'attribute', label: 'Attribute', property: 'attributes.attribute', type: 'multiSelect' },
      { id: 'cost', label: 'Cost', property: 'attributes.cost', type: 'numberRange', min: 0, max: 20, step: 1 },
      { id: 'power', label: 'Power', property: 'attributes.power', type: 'numberRange', min: 0, max: 20000, step: 1000 },
      { id: 'rules', label: 'Card text', property: 'attributes.effect', type: 'text', mode: 'contains', maxLength: 160 },
    ] },
    collection: {
      identityModes,
      defaultIdentityMode: 'collector',
      facets: [
        { id: 'color', label: 'Color', property: 'attributes.color', type: 'multiSelect' },
        { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
        { id: 'attribute', label: 'Attribute', property: 'attributes.attribute', type: 'multiSelect' },
        { id: 'cost', label: 'Cost', property: 'attributes.cost', type: 'numberRange', min: 0, max: 20, step: 1 },
        { id: 'power', label: 'Power', property: 'attributes.power', type: 'numberRange', min: 0, max: 20000, step: 1000 },
        ...physicalFacets,
      ],
    },
  },
  lorcana: {
    id: 'lorcana',
    label: 'Disney Lorcana',
    search: { facets: [
      ...commonSearchFacets,
      { id: 'ink', label: 'Ink', property: 'attributes.ink', type: 'multiSelect' },
      { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
      { id: 'classification', label: 'Classification', property: 'attributes.classifications', type: 'multiSelect' },
      { id: 'cost', label: 'Cost', property: 'attributes.cost', type: 'numberRange', min: 0, max: 20, step: 1 },
      { id: 'lore', label: 'Lore', property: 'attributes.lore', type: 'numberRange', min: 0, max: 10, step: 1 },
      { id: 'rules', label: 'Card text', property: 'attributes.body_text', type: 'text', mode: 'contains', maxLength: 160 },
    ] },
    collection: {
      identityModes,
      defaultIdentityMode: 'collector',
      facets: [
        { id: 'ink', label: 'Ink', property: 'attributes.ink', type: 'multiSelect' },
        { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
        { id: 'classification', label: 'Classification', property: 'attributes.classifications', type: 'multiSelect' },
        { id: 'cost', label: 'Cost', property: 'attributes.cost', type: 'numberRange', min: 0, max: 20, step: 1 },
        { id: 'lore', label: 'Lore', property: 'attributes.lore', type: 'numberRange', min: 0, max: 10, step: 1 },
        ...physicalFacets,
      ],
    },
  },
  dragonball: {
    id: 'dragonball',
    label: 'Dragon Ball Super',
    search: { facets: [
      ...commonSearchFacets,
      { id: 'color', label: 'Color', property: 'attributes.color', type: 'multiSelect' },
      { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
      { id: 'character', label: 'Character', property: 'attributes.character', type: 'text', mode: 'contains', maxLength: 80 },
      { id: 'era', label: 'Era', property: 'attributes.era', type: 'multiSelect' },
      { id: 'energy', label: 'Energy', property: 'attributes.energy', type: 'numberRange', min: 0, max: 20, step: 1 },
      { id: 'power', label: 'Power', property: 'attributes.power', type: 'numberRange', min: 0, max: 100000, step: 1000 },
      { id: 'rules', label: 'Card text', property: 'attributes.skill', type: 'text', mode: 'contains', maxLength: 160 },
    ] },
    collection: {
      identityModes,
      defaultIdentityMode: 'collector',
      facets: [
        { id: 'color', label: 'Color', property: 'attributes.color', type: 'multiSelect' },
        { id: 'card-type', label: 'Card type', property: 'attributes.type', type: 'multiSelect' },
        { id: 'character', label: 'Character', property: 'attributes.character', type: 'text', mode: 'contains', maxLength: 80 },
        { id: 'era', label: 'Era', property: 'attributes.era', type: 'multiSelect' },
        { id: 'energy', label: 'Energy', property: 'attributes.energy', type: 'numberRange', min: 0, max: 20, step: 1 },
        { id: 'power', label: 'Power', property: 'attributes.power', type: 'numberRange', min: 0, max: 100000, step: 1000 },
        ...physicalFacets,
      ],
    },
  },
};

for (const code of TCG_CODES) gameDefinitionSchema.parse(definitions[code]);

export const GAME_DEFINITIONS: Readonly<Record<TcgCode, GameDefinition>> = definitions;

export function getGameDefinition(tcg: TcgCode): GameDefinition {
  return GAME_DEFINITIONS[tcg];
}

function flattenPathValues(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => flattenPathValues(item, keys));
  if (!keys.length) return value === undefined || value === null ? [] : [value];
  if (!value || typeof value !== 'object') return [];
  const [key, ...rest] = keys;
  return flattenPathValues((value as Record<string, unknown>)[key!], rest);
}

export function collectionFacetValues(card: CollectionFacetCard, property: string): unknown[] {
  return flattenPathValues(card, property.split('.'));
}

function equalValue(actual: unknown, expected: unknown): boolean {
  return actual === expected || String(actual).toLocaleLowerCase() === String(expected).toLocaleLowerCase();
}

export function matchesCollectionFacets(
  card: CollectionFacetCard,
  facets: readonly CollectionFacet[],
  selections: Readonly<Record<string, GameFilterSelection | undefined>>,
): boolean {
  return facets.every((facet) => {
    const selected = selections[facet.id];
    if (selected === undefined || selected === '' || (Array.isArray(selected) && selected.length === 0)) return true;
    const values = collectionFacetValues(card, facet.property);
    switch (facet.type) {
      case 'select':
        return values.some((actual) => equalValue(actual, selected));
      case 'multiSelect':
        return Array.isArray(selected) && selected.some((expected) => values.some((actual) => equalValue(actual, expected)));
      case 'boolean':
        return typeof selected === 'boolean' && values.some((actual) => actual === selected);
      case 'text': {
        const needle = String(selected).toLocaleLowerCase();
        return values.some((actual) => {
          const haystack = String(actual).toLocaleLowerCase();
          return facet.mode === 'equals' ? haystack === needle : haystack.includes(needle);
        });
      }
      case 'numberRange': {
        if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return true;
        return values.some((actual) => {
          const numeric = typeof actual === 'number' ? actual : Number(actual);
          return Number.isFinite(numeric)
            && (selected.min === undefined || numeric >= selected.min)
            && (selected.max === undefined || numeric <= selected.max);
        });
      }
    }
  });
}

export function collectionFacetOptions(
  cards: readonly CollectionFacetCard[],
  facet: CollectionFacet,
): Array<{ value: string | number | boolean; label: string }> {
  if ('options' in facet && facet.options?.length) return facet.options;
  const values = new Map<string, string | number | boolean>();
  cards.flatMap((card) => collectionFacetValues(card, facet.property)).forEach((value) => {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
    const normalized = String(value).trim();
    if (normalized) values.set(normalized.toLocaleLowerCase(), value);
  });
  return [...values.values()]
    .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }))
    .slice(0, 200)
    .map((value) => ({ value, label: String(value) }));
}
