import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

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
            { label: 'API Guide', link: '/reference/api/' },
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
