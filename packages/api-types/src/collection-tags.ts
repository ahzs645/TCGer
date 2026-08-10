import type { TcgCode } from './cards';

export interface CollectionTagInput {
  id?: string;
  tcg: TcgCode;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  category?: string;
  stage?: string;
  suffix?: string;
  type?: string;
  types?: string[];
  archetype?: string;
  classifications?: string[];
  subtypes?: string[];
  variants?: string[];
  source?: string;
  character?: string;
  era?: string;
  specialTrait?: string;
  treatments?: string[];
}

export function collectionTagSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[★☆]/g, ' star ')
    .replace(/δ/gi, ' delta ')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function addFieldTags(tags: Set<string>, namespace: string, values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const slug = collectionTagSlug(value);
    if (slug) tags.add(`${namespace}.${slug}`);
  }
}

function addPokemonTags(tags: Set<string>, card: CollectionTagInput) {
  const name = card.name.trim();
  const rarity = collectionTagSlug(card.rarity ?? '');
  const stage = collectionTagSlug(card.stage ?? '');
  const rawSuffix = card.suffix?.trim();
  const suffix = collectionTagSlug(rawSuffix ?? '');
  const setCode = (card.setCode ?? '').toLowerCase();
  const number = (card.collectorNumber ?? '').toUpperCase();
  const id = (card.id ?? '').toLowerCase();

  if (
    name.includes('δ')
    || id === 'swshp-swsh136'
    || id === 'cel25cc-cc014'
  ) tags.add('pokemon.delta-species');
  if (/^Dark\s/.test(name)) tags.add('pokemon.dark');
  if (/^Light\s/.test(name)) tags.add('pokemon.light');
  if (/^Shining\s/.test(name)) tags.add('pokemon.shining');
  if (/^Radiant\s/.test(name) || rarity === 'radiant-rare') tags.add('pokemon.radiant');
  if (/[★☆]/.test(name)) tags.add('pokemon.gold-star');
  if (/◇\s*$/.test(name)) tags.add('pokemon.prism-star');

  if (rawSuffix === 'EX') tags.add('pokemon.ex-uppercase');
  if (rawSuffix === 'ex') tags.add('pokemon.ex');

  const suffixTags: Record<string, string> = {
    gx: 'pokemon.gx',
    v: 'pokemon.v',
    legend: 'pokemon.legend',
    prime: 'pokemon.prime',
    sp: 'pokemon.sp',
    'tag-team-gx': 'pokemon.tag-team',
  };
  if (suffixTags[suffix]) tags.add(suffixTags[suffix]!);

  const stageTags: Record<string, string> = {
    break: 'pokemon.break',
    'level-up': 'pokemon.lv-x',
    mega: 'pokemon.mega',
    restored: 'pokemon.restored',
    'v-union': 'pokemon.v-union',
    vmax: 'pokemon.vmax',
    vstar: 'pokemon.vstar',
    baby: 'pokemon.baby',
  };
  if (stageTags[stage]) tags.add(stageTags[stage]!);

  const rarityTags: Record<string, string> = {
    'ace-spec-rare': 'pokemon.ace-spec',
    'amazing-rare': 'pokemon.amazing',
    'classic-collection': 'pokemon.classic-collection',
    'illustration-rare': 'pokemon.illustration-rare',
    'special-illustration-rare': 'pokemon.special-illustration-rare',
    'shiny-rare': 'pokemon.shiny-rare',
    'shiny-ultra-rare': 'pokemon.shiny-ultra-rare',
    'black-white-rare': 'pokemon.black-white-rare',
    'futuristic-rare': 'pokemon.futuristic-rare',
    'mega-attack-rare': 'pokemon.mega-attack-rare',
    'mega-hyper-rare': 'pokemon.mega-hyper-rare',
    'hyper-rare': 'pokemon.hyper-rare',
    'secret-rare': 'pokemon.secret-rare',
  };
  if (rarityTags[rarity]) tags.add(rarityTags[rarity]!);

  if (number.startsWith('TG')) tags.add('pokemon.trainer-gallery');
  if (number.startsWith('GG')) tags.add('pokemon.galarian-gallery');
  if (number.startsWith('SV') || setCode === 'sv') tags.add('pokemon.shiny-vault');

  const artist = collectionTagSlug(card.artist ?? '');
  if (['yuka-morii', 'sachiko-adachi', 'hizuki-misono'].includes(artist)) {
    tags.add('pokemon.art.clay');
  }
  if (artist === 'asako-ito') tags.add('pokemon.art.crochet');

  const semanticValues = [...(card.classifications ?? []), ...(card.subtypes ?? [])]
    .map(collectionTagSlug);
  const semanticTags: Record<string, string> = {
    ancient: 'pokemon.ancient',
    future: 'pokemon.future',
    'ancient-trait': 'pokemon.ancient-trait',
    'fusion-strike': 'pokemon.fusion-strike',
    'rapid-strike': 'pokemon.rapid-strike',
    'single-strike': 'pokemon.single-strike',
    'team-plasma': 'pokemon.team-plasma',
    'ultra-beast': 'pokemon.ultra-beast',
    tera: 'pokemon.tera',
    crystal: 'pokemon.crystal',
  };
  for (const value of semanticValues) {
    if (semanticTags[value]) tags.add(semanticTags[value]!);
  }
}

function addMagicTags(tags: Set<string>, card: CollectionTagInput) {
  const type = (card.type ?? '').toLowerCase();
  if (type.includes('planeswalker')) tags.add('magic.planeswalker');
  if (type.includes('legendary')) tags.add('magic.legendary');
  if (type.includes('basic land')) tags.add('magic.basic-land');
  for (const treatment of card.treatments ?? []) {
    const value = collectionTagSlug(treatment);
    const aliases: Record<string, string> = {
      showcase: 'magic.showcase',
      extendedart: 'magic.extended-art',
      'extended-art': 'magic.extended-art',
      'full-art': 'magic.full-art',
      'borderless-border': 'magic.borderless',
      etched: 'magic.etched',
      serialized: 'magic.serialized',
      'retro-frame': 'magic.retro-frame',
    };
    tags.add(aliases[value] ?? `magic.treatment.${value}`);
  }
}

function addYugiohTags(tags: Set<string>, card: CollectionTagInput) {
  addFieldTags(tags, 'yugioh.archetype', [card.archetype]);
  const rarity = collectionTagSlug(card.rarity ?? '');
  const specialRarities = new Set([
    'ghost-rare', 'ultimate-rare', 'starlight-rare', 'collectors-rare',
    'collector-s-rare', 'quarter-century-secret-rare', 'platinum-secret-rare',
  ]);
  if (specialRarities.has(rarity)) tags.add(`yugioh.${rarity}`);
  if ((card.variants ?? []).some((value) => collectionTagSlug(value) === 'alternate-art')) {
    tags.add('yugioh.alternate-art');
  }
  const setName = collectionTagSlug(card.setName ?? '');
  if (setName.includes('lost-art-promotion')) tags.add('yugioh.lost-art');
  if (setName.includes('duel-terminal')) tags.add('yugioh.duel-terminal');
}

function addLorcanaTags(tags: Set<string>, card: CollectionTagInput) {
  addFieldTags(tags, 'lorcana.classification', card.classifications ?? []);
  const rarity = collectionTagSlug(card.rarity ?? '');
  if (['enchanted', 'epic', 'iconic', 'promo'].includes(rarity)) {
    tags.add(`lorcana.${rarity}`);
  }
  const type = collectionTagSlug(card.type ?? '');
  if (type.includes('song')) tags.add('lorcana.song');
  if (type.includes('location')) tags.add('lorcana.location');
}

function addOnePieceTags(tags: Set<string>, card: CollectionTagInput) {
  const rarity = collectionTagSlug(card.rarity ?? '');
  const rarityAliases: Record<string, string> = {
    tr: 'onepiece.treasure-rare',
    sp: 'onepiece.special-rare',
    sec: 'onepiece.secret-rare',
    l: 'onepiece.leader',
    pr: 'onepiece.promo',
  };
  if (rarityAliases[rarity]) tags.add(rarityAliases[rarity]!);
  const type = collectionTagSlug(card.type ?? '');
  if (type.includes('don')) tags.add('onepiece.don');
}

function addDragonBallTags(tags: Set<string>, card: CollectionTagInput) {
  addFieldTags(tags, 'dragonball.character', [card.character]);
  addFieldTags(tags, 'dragonball.era', [card.era]);
  addFieldTags(tags, 'dragonball.trait', [card.specialTrait]);
  const rarity = collectionTagSlug(card.rarity ?? '');
  if (rarity) tags.add(`dragonball.rarity.${rarity}`);
}

export function deriveCollectionTags(card: CollectionTagInput): string[] {
  const tags = new Set<string>();
  addFieldTags(tags, `${card.tcg}.rarity`, [card.rarity]);
  addFieldTags(tags, `${card.tcg}.type`, [card.type]);
  addFieldTags(tags, `${card.tcg}.classification`, card.classifications ?? []);
  addFieldTags(tags, `${card.tcg}.treatment`, card.treatments ?? []);

  switch (card.tcg) {
    case 'pokemon': addPokemonTags(tags, card); break;
    case 'magic': addMagicTags(tags, card); break;
    case 'yugioh': addYugiohTags(tags, card); break;
    case 'lorcana': addLorcanaTags(tags, card); break;
    case 'onepiece': addOnePieceTags(tags, card); break;
    case 'dragonball': addDragonBallTags(tags, card); break;
  }
  return [...tags].sort();
}
