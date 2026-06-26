import { defineConfig } from 'vitepress';

// On GitHub Pages, the site is served from https://<user>.github.io/<repo>/
// and must be built with `base: "/<repo>/"`. Locally we fall back to "/".
const base = process.env.VITEPRESS_BASE_PATH ?? '/';

export default defineConfig({
  title: 'LayerAll',
  description: 'Um SDK. N provedores. Uma engine de orquestração.',
  lang: 'pt-BR',
  base,
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guia', link: '/guide/getting-started' },
      { text: 'Tutorial', link: '/tutorials/allgeo' },
      { text: 'GitHub', link: 'https://github.com/sidartaveloso/layerall' },
    ],
    sidebar: [
      {
        text: 'Guia',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Estratégias', link: '/guide/strategies' },
          { text: 'Observabilidade', link: '/guide/observability' },
        ],
      },
      {
        text: 'Tutorial',
        items: [
          { text: 'AllGeo (geocode reverso)', link: '/tutorials/allgeo' },
        ],
      },
      {
        text: 'SDK',
        items: [
          { text: 'Referência do SDK', link: '/sdk/quick-start' },
        ],
      },
      {
        text: 'CLI',
        items: [
          { text: 'Comandos', link: '/cli/commands' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'Prometheus', link: '/plugins/prometheus' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/sidartaveloso/layerall' }],
    footer: {
      message: 'MIT License',
      copyright: 'Copyright © 2026 Sidarta Veloso',
    },
    search: {
      provider: 'local',
    },
  },
});