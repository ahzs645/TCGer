import type { PriceSourceOption, PriceSourcesResponse } from '@tcg/api-types';
import { env } from '../../config/env';

const automatic: PriceSourceOption = {
  id: 'automatic',
  label: 'Best available',
  description: 'Use the first compatible market source for each game and card.',
  games: [],
  requiresServer: true,
};

export function getPriceSourceCatalog(): PriceSourcesResponse {
  const sources: PriceSourceOption[] = [
    automatic,
    {
      id: 'tcgdex-cardmarket',
      label: 'Cardmarket via TCGdex',
      description: 'Cardmarket reference prices published with the TCGdex Pokémon catalog.',
      games: ['pokemon'],
      requiresServer: true,
    },
    {
      id: 'scryfall',
      label: 'Scryfall',
      description: 'Current regular, foil, and etched USD or EUR market prices for Magic cards.',
      games: ['magic'],
      requiresServer: true,
    },
    {
      id: 'lorcast',
      label: 'Lorcast',
      description: 'Current USD prices for Disney Lorcana cards.',
      games: ['lorcana'],
      requiresServer: true,
    },
    {
      id: 'card-source',
      label: 'Catalog market price',
      description: 'Market values included by the configured game catalog provider.',
      games: ['yugioh', 'onepiece', 'dragonball'],
      requiresServer: true,
    },
  ];

  if (env.JUSTTCG_API_KEY) {
    sources.push({
      id: 'justtcg',
      label: 'JustTCG',
      description:
        'Condition, language, and printing-aware prices from the server-held JustTCG key.',
      games: ['magic', 'pokemon', 'yugioh', 'onepiece', 'lorcana', 'dragonball'],
      requiresServer: true,
    });
  }

  if (env.POKEWALLET_API_KEY || env.POKEWALLET_PROXY_SECRET) {
    sources.push(
      {
        id: 'pokewallet-cardmarket',
        label: 'PokéWallet · Cardmarket',
        description: 'Pokémon Cardmarket reference price in EUR.',
        games: ['pokemon'],
        requiresServer: true,
      },
      {
        id: 'pokewallet-tcgplayer',
        label: 'PokéWallet · TCGPlayer',
        description: 'Pokémon TCGPlayer mid or market price in USD.',
        games: ['pokemon'],
        requiresServer: true,
      },
    );
    if (env.PRICE_USD_TO_EUR && env.PRICE_FX_SOURCE && env.PRICE_FX_AS_OF) {
      sources.push({
        id: 'pokewallet-blended',
        label: 'PokéWallet · Blended',
        description: `Average of native EUR and USD quotes using ${env.PRICE_FX_SOURCE} FX dated ${env.PRICE_FX_AS_OF}.`,
        games: ['pokemon'],
        requiresServer: true,
      });
    }
  }

  sources.push({
    id: 'tcgcsv',
    label: 'TCGCSV · TCGplayer',
    description:
      'Daily no-key Pokémon singles prices with language-scoped, ambiguity-safe matching.',
    games: ['pokemon'],
    requiresServer: true,
  });

  if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) {
    sources.push({
      id: 'ebay-active',
      label: 'eBay active listings',
      description: 'Median active-listing asking price after basic outlier filtering.',
      games: [],
      requiresServer: true,
    });
  }

  return { sources, defaultSource: 'automatic' };
}
