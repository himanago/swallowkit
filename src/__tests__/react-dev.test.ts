import ts from "typescript";
import {
  buildReactDevConfigSource,
  buildReactDevWatchIgnoredSource,
} from "../utils/react-dev";
import { buildReactDevArgs } from "../cli/commands/dev";

describe("React dev watch boundaries", () => {
  it.each(["C:\\repo\\", "C:\\repo", "/repo/"])(
    "ignores backend artifacts without excluding frontend or shared sources under %s",
    root => {
      const ignored: string[] = new Function("root", `return ${buildReactDevWatchIgnoredSource("root")}`)(root);
      const normalized = root.replace(/\\/g, "/").replace(/\/$/, "");
      expect(ignored).toEqual([
        `${normalized}/functions/**`,
        `${normalized}/bff/**`,
        `${normalized}/.uv/**`,
        `${normalized}/.swallowkit/**`,
        `${normalized}/shared/dist/**`,
      ]);
      expect(ignored.some(value => value.includes("/src/") || value.includes("/shared/models/"))).toBe(false);
    }
  );

  function loadWrapper(config: object) {
    const loadConfigFromFile = jest.fn(async () => ({
      config,
      dependencies: ["/repo/vite.config.mts", "/repo/vite-settings.ts"],
    }));
    const mergeConfig = jest.fn((base: object, overrides: object) => ({ base, overrides }));
    const result = { exports: {} as { default: (env: object) => Promise<unknown> } };
    const source = ts.transpileModule(buildReactDevConfigSource(), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", source)(
      () => ({ defineConfig: (value: unknown) => value, loadConfigFromFile, mergeConfig }),
      result.exports
    );
    return { load: result.exports.default, loadConfigFromFile, mergeConfig };
  }

  it("loads the user's Vite config and merges rather than replacing their watch options", async () => {
    const config = { plugins: ["user-plugin"], server: { watch: { ignored: ["**/custom/**"], usePolling: true } } };
    const wrapper = loadWrapper(config);
    const env = { command: "serve", mode: "development" };
    await wrapper.load(env);
    expect(wrapper.loadConfigFromFile).toHaveBeenCalledWith(env, undefined, process.cwd());
    expect(wrapper.mergeConfig).toHaveBeenCalledWith(config, {
      plugins: [expect.objectContaining({ name: "swallowkit-dev-watch-boundaries" })],
      server: { watch: { ignored: expect.arrayContaining([expect.stringContaining("/functions/**")]) } },
    });
    const plugin = wrapper.mergeConfig.mock.calls[0][1] as {
      plugins: Array<{ configResolved: (config: { configFileDependencies: string[] }) => void }>;
    };
    const resolved = { configFileDependencies: ["/repo/wrapper.mjs"] };
    plugin.plugins[0].configResolved(resolved);
    expect(resolved.configFileDependencies).toContain("/repo/vite.config.mts");
  });

  it("respects an explicitly disabled watcher", async () => {
    const config = { server: { watch: null } };
    const wrapper = loadWrapper(config);
    await expect(wrapper.load({})).resolves.toBe(config);
    expect(wrapper.mergeConfig).not.toHaveBeenCalled();
  });

  it("passes the override config to existing projects without editing their Vite config", () => {
    expect(buildReactDevArgs("pnpm", "3100", "127.0.0.1", ".swallowkit/config.mjs")).toEqual([
      "exec", "vite", "--port", "3100", "--host", "127.0.0.1", "--strictPort", "--config", ".swallowkit/config.mjs",
    ]);
  });
});
