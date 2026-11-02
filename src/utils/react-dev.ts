import * as fs from "fs";
import * as path from "path";

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

export function createReactDevConfig(projectRoot: string): { directory: string; configPath: string; cleanup: () => void } {
  const localDirectory = path.join(projectRoot, ".swallowkit");
  const ignorePath = path.join(localDirectory, ".gitignore");
  const rule = "/vite-dev-*/";
  try {
    fs.mkdirSync(localDirectory, { recursive: true });
    const previous = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf-8") : "";
    const lines = previous.split(/\r?\n/);
    if (lines.filter((line) => line.trim()).at(-1) !== rule) {
      const newline = previous.includes("\r\n") ? "\r\n" : "\n";
      const preserved = lines.filter((line) => line !== rule).join(newline);
      fs.writeFileSync(ignorePath, `${preserved}${preserved && !preserved.endsWith(newline) ? newline : ""}${rule}${newline}`, "utf-8");
    }
  } catch (error) {
    throw new Error(`Cannot guarantee Git exclusion for React dev temporary files: failed to prepare ${ignorePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const directory = fs.mkdtempSync(path.join(localDirectory, "vite-dev-"));
  const configPath = path.join(directory, "config.mjs");
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    fs.writeFileSync(configPath, buildReactDevConfigSource(), "utf-8");
  } catch (error) {
    cleanup();
    throw error;
  }
  return { directory, configPath, cleanup };
}
