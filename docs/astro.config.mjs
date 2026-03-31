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
