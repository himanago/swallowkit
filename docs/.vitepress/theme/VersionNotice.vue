<script setup lang="ts">
import { useData, withBase } from 'vitepress';
import { computed } from 'vue';
import { version } from '../../../package.json';

const { lang } = useData();
const japanese = computed(() => lang.value === 'ja');
</script>

<template>
  <aside class="version-notice" :aria-label="japanese ? '対象バージョン' : 'Documentation version'">
    <template v-if="japanese">
      <strong>SwallowKit 2.x のドキュメント（{{ version }}）</strong>
      <p>2.x はプレリリースです。npm の安定版 1.x とは仕様が異なります。React + Vite は 2.x からの対応です。</p>
      <a :href="withBase('/ja/versions')">対象バージョンとインストール方法</a>
    </template>
    <template v-else>
      <strong>SwallowKit 2.x documentation ({{ version }})</strong>
      <p>2.x is a prerelease and differs from the stable 1.x npm release. React + Vite support starts in 2.x.</p>
      <a :href="withBase('/en/versions')">Versions and installation</a>
    </template>
  </aside>
</template>

<style scoped>
.version-notice {
  margin: 0 0 24px;
  padding: 16px 20px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.7;
}
.version-notice p { margin: 4px 0; }
.version-notice a { color: var(--vp-c-brand-1); text-decoration: underline; }
:global(.VPHome) > .version-notice { max-width: 1152px; margin: 24px auto 0; }
@media (max-width: 1199px) {
  :global(.VPHome) > .version-notice { margin-right: 24px; margin-left: 24px; }
}
</style>
