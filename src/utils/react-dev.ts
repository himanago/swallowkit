export const REACT_DEV_WATCH_DIRECTORIES = [
  "functions",
  "bff",
  ".uv",
  ".swallowkit",
  "shared/dist",
];

export function buildReactDevWatchIgnoredSource(rootExpression: string): string {
  return `${JSON.stringify(REACT_DEV_WATCH_DIRECTORIES)}.map(directory => \`\${${rootExpression}.replace(/\\\\/g, '/').replace(/\\/$/, '')}/\${directory}/**\`)`;
}

export function buildReactDevConfigSource(): string {
  return `import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite';

export default defineConfig(async env => {
  const loaded = await loadConfigFromFile(env, undefined, process.cwd());
  const config = loaded?.config ?? {};
  if (config.server?.watch === null) return config;
  return mergeConfig(config, {
    plugins: [{
      name: 'swallowkit-dev-watch-boundaries',
      configResolved(resolved) {
        resolved.configFileDependencies.push(...(loaded?.dependencies ?? []));
      },
    }],
    server: { watch: { ignored: ${buildReactDevWatchIgnoredSource("process.cwd()")} } },
  });
});
`;
}
