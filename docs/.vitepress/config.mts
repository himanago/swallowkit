import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'SwallowKit',
  description:
    'Type-safe schema-driven development toolkit for Next.js applications on Azure',
  base: '/swallowkit/',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['meta', { name: 'theme-color', content: '#0078d4' }],
    [
      'meta',
      {
        name: 'og:image',
        content: 'https://himanago.github.io/swallowkit/og-image.png',
      },
    ],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'SwallowKit',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/himanago/swallowkit' },
      {
        icon: 'npm',
        link: 'https://www.npmjs.com/package/swallowkit',
      },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Takumasa Hirabayashi',
    },

    search: {
      provider: 'local',
    },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      title: 'SwallowKit',
      description:
        'Type-safe schema-driven development toolkit for Next.js applications on Azure',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/scaffold-guide' },
          { text: 'CLI Reference', link: '/en/cli-reference' },
          { text: 'Deployment', link: '/en/deployment-guide' },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/package/swallowkit',
          },
        ],
        sidebar: {
          '/en/': [
            {
              text: 'Getting Started',
              items: [
                { text: 'Introduction', link: '/en/' },
                { text: 'Scaffold Guide', link: '/en/scaffold-guide' },
                {
                  text: 'Zod Schema Sharing',
                  link: '/en/zod-schema-sharing-guide',
                },
              ],
            },
            {
              text: 'Reference',
              items: [
                { text: 'CLI Reference', link: '/en/cli-reference' },
                { text: 'Deployment Guide', link: '/en/deployment-guide' },
              ],
            },
          ],
        },
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja',
      title: 'SwallowKit',
      description:
        'Azure 上の Next.js アプリケーション向けの型安全なスキーマ駆動開発ツールキット',
      themeConfig: {
        nav: [
          { text: 'ガイド', link: '/ja/scaffold-guide' },
          { text: 'CLI リファレンス', link: '/ja/cli-reference' },
          { text: 'デプロイ', link: '/ja/deployment-guide' },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/package/swallowkit',
          },
        ],
        sidebar: {
          '/ja/': [
            {
              text: 'はじめに',
              items: [
                { text: 'イントロダクション', link: '/ja/' },
                { text: 'Scaffold ガイド', link: '/ja/scaffold-guide' },
                {
                  text: 'Zod スキーマ共有',
                  link: '/ja/zod-schema-sharing-guide',
                },
              ],
            },
            {
              text: 'リファレンス',
              items: [
                { text: 'CLI リファレンス', link: '/ja/cli-reference' },
                { text: 'デプロイガイド', link: '/ja/deployment-guide' },
              ],
            },
          ],
        },
      },
    },
  },
});
