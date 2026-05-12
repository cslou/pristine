import { defineConfig } from 'vocs';

export default defineConfig({
  title: 'Pristine',
  description: 'Local-first privacy and source-pointer memory SDK for TypeScript.',
  rootDir: 'docs',
  topNav: [
    { text: 'Docs', link: '/' },
    { text: 'GitHub', link: 'https://github.com/getlou-gh/pristine' },
  ],
  sidebar: [
    { text: 'Intro', link: '/' },
    { text: 'Quickstart', link: '/quickstart' },
    { text: 'Concepts', link: '/concepts' },
    { text: 'API', link: '/api' },
    { text: 'Privacy', link: '/privacy' },
    { text: 'Pi-dev', link: '/pi-dev' },
    { text: 'Configuration', link: '/configuration' },
    { text: 'Examples', link: '/examples' },
  ],
});
