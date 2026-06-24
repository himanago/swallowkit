import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'SwallowKit',
  description:
    'Schema-driven application scaffolding for Next.js and Azure',
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
        'Schema-driven application scaffolding for Next.js and Azure',
      themeConfig: {
        nav: [
          { text: 'Getting Started', link: '/en/getting-started' },
          { text: 'Guides', link: '/en/scaffold-guide' },
          { text: 'CLI Reference', link: '/en/cli-reference' },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/package/swallowkit',
          },
          {
            text: 'VS Code Extension',
            link: 'https://marketplace.visualstudio.com/items?itemName=himanago.swallowkit-vscode',
          },
        ],
        sidebar: {
          '/en/': [
            {
              text: 'Overview',
              items: [
                { text: 'Introduction', link: '/en/' },
                { text: 'Getting started', link: '/en/getting-started' },
                { text: 'Core concepts', link: '/en/concepts' },
              ],
            },
            {
              text: 'Guides',
              items: [
                { text: 'Scaffold (CRUD generation)', link: '/en/scaffold-guide' },
                { text: 'Local development', link: '/en/dev-guide' },
                { text: 'Deploy to Azure', link: '/en/deployment-guide' },
                { text: 'AI / MCP integration', link: '/en/ai-mcp-guide' },
                { text: 'Authentication', link: '/en/auth-guide' },
                { text: 'External connectors', link: '/en/connector-guide' },
              ],
            },
            {
              text: 'Reference',
              items: [
                { text: 'CLI reference', link: '/en/cli-reference' },
                { text: 'Zod schema sharing', link: '/en/zod-schema-sharing-guide' },
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
        'Next.js と Azure のためのスキーマ駆動アプリケーション scaffolding',
      themeConfig: {
        nav: [
          { text: 'はじめる', link: '/ja/getting-started' },
          { text: 'ガイド', link: '/ja/scaffold-guide' },
          { text: 'CLI リファレンス', link: '/ja/cli-reference' },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/package/swallowkit',
          },
          {
            text: 'VS Code 拡張機能',
            link: 'https://marketplace.visualstudio.com/items?itemName=himanago.swallowkit-vscode',
          },
        ],
        sidebar: {
          '/ja/': [
            {
              text: '概要',
              items: [
                { text: 'イントロダクション', link: '/ja/' },
                { text: 'はじめる', link: '/ja/getting-started' },
                { text: '基本概念', link: '/ja/concepts' },
              ],
            },
            {
              text: 'ガイド',
              items: [
                { text: 'Scaffold（CRUD 生成）', link: '/ja/scaffold-guide' },
                { text: 'ローカル開発', link: '/ja/dev-guide' },
                { text: 'Azure へのデプロイ', link: '/ja/deployment-guide' },
                { text: 'AI / MCP 統合', link: '/ja/ai-mcp-guide' },
                { text: '認証', link: '/ja/auth-guide' },
                { text: '外部コネクタ', link: '/ja/connector-guide' },
              ],
            },
            {
              text: 'リファレンス',
              items: [
                { text: 'CLI リファレンス', link: '/ja/cli-reference' },
                { text: 'Zod スキーマ共有', link: '/ja/zod-schema-sharing-guide' },
              ],
            },
          ],
        },
      },
    },
  },
});
