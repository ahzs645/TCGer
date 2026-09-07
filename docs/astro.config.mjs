import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const API_DOCS_URL = 'https://tcger.ahmadjalil.com/api/docs/';

export default defineConfig({
  integrations: [
    starlight({
      title: 'TCGer Docs',
      description:
        'Documentation for TCGer, a multi-game trading card collection manager.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/ahzs645/TCGer'
        }
      ],
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Overview', link: '/' },
            { label: 'Getting Started', link: '/getting-started/' },
            { label: 'Local Development', link: '/local-development/' }
          ]
        },
        {
          label: 'Adding Games',
          items: [
            { label: 'Start Here', link: '/adding-games/' },
            { label: 'Catalogs and Identity', link: '/adding-games/catalogs/' },
            { label: 'Search and Collections', link: '/adding-games/search-and-collections/' },
            { label: 'Deck Rules', link: '/adding-games/decks/' },
            { label: 'Printings and Finishes', link: '/adding-games/printings-and-finishes/' },
            { label: 'Format Legality', link: '/adding-games/legality/' },
            { label: 'Symbols and Presentation', link: '/adding-games/symbols/' },
            { label: 'Price Snapshots', link: '/adding-games/pricing/' },
            { label: 'Pack Opening', link: '/adding-games/packs/' },
            { label: 'Scanning', link: '/adding-games/scanning/' },
            { label: 'Sealed Products', link: '/adding-games/sealed-products/' },
            { label: 'Publishing and Validation', link: '/adding-games/publishing/' }
          ]
        },
        {
          label: 'Reference',
          items: [
            { label: 'API Guide', link: API_DOCS_URL },
            { label: 'Architecture', link: '/reference/architecture/' }
          ]
        },
        {
          label: 'Project',
          items: [{ label: 'Contributing', link: '/project/contributing/' }]
        }
      ]
    })
  ]
});
