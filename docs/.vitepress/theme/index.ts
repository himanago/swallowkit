import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import VersionNotice from './VersionNotice.vue';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'doc-before': () => h(VersionNotice),
    'home-hero-before': () => h(VersionNotice),
  }),
};
