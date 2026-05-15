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
    {
      text: 'Start',
      items: [
        { text: 'Overview', link: '/' },
        { text: 'Quickstart', link: '/quickstart' },
      ],
    },
    {
      text: 'Memory',
      items: [
        { text: 'Overview', link: '/memory' },
        { text: 'How it works', link: '/memory/how-it-works' },
        { text: 'Store, recall, forget', link: '/memory/store-recall-forget' },
      ],
    },
    {
      text: 'Privacy',
      items: [
        { text: 'Overview', link: '/privacy' },
        { text: 'How it works', link: '/privacy/how-it-works' },
        { text: 'Secure, redact, reveal', link: '/privacy/secure-redact-reveal' },
      ],
    },
    {
      text: 'Integrations',
      items: [
        { text: 'Pi-dev', link: '/pi-dev' },
        { text: 'Examples', link: '/examples' },
      ],
    },
    {
      text: 'Agent setup',
      items: [{ text: 'Agent setup prompts', link: '/agent-setup' }],
    },
    {
      text: 'Reference',
      items: [
        { text: 'API', link: '/api' },
        { text: 'Configuration', link: '/configuration' },
      ],
    },
  ],
});
