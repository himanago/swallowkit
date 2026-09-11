# pnpm consumer compatibility audit

Maintainer verification record; excluded from the public documentation site.

Audit date: 2026-09-10.

**2026-09-11 correction:** beta.61 regressed SWA deployment: the audit below covered runner builds and Functions staging, but not npm invoked inside SWA/Oryx. SWA templates now restore CI-only npm normalization, including `devEngines.packageManager`; local pnpm and Functions CI remain unchanged. Executable regression tests reproduce `EBADDEVENGINES` before conversion and verify npm succeeds afterward. The consumer smoke now also copies the pnpm app into a clean SWA checkout, executes its generated normalization, and runs npm lockfile generation, `npm ci`, and build. Live Azure deployment is still a separate validation boundary. Verified on 2026-09-11: the packed pnpm 12.3.4 TypeScript consumer passed the new SWA normalization, npm lockfile generation, clean npm install and Next.js build; the original project retained pnpm metadata and no npm lockfile. Evidence: `/tmp/swallowkit-consumer-pnpm-12-gyX8WM/20-npm.log` through `22-npm.log`. All 474 Jest tests and the documentation build passed. The maintainer repository remains npm-managed. MCP's intentional `latest` default is retained.

**2026-09-11 setup-node follow-up:** The replacement workflow still enabled npm caching before normalization. GitHub's setup-node invokes `npm config get cache`, which also fails pnpm's `devEngines` requirement. Conversion workflows now omit setup-node cache inputs; matching-manager workflows retain caching. Regression tests execute that exact npm command before and after conversion, and assert cache inputs are absent for conversion workflows. The build and all 31 init tests passed. This follow-up has not been deployed to Azure.

**2026-09-11 Oryx follow-up:** A subsequent live deployment exposed two further gaps. The beta.60 app manifest constrained Node to `20.x`; beta.61's unbounded `>=22.14.0` allowed Oryx to select Node 24, which the reported SWA deployment rejected. SWA workflows now constrain the disposable checkout to `>=22.14.0 <23` while preserving the local/CLI Node range. The GitHub SWA action now uses only `npm run build` after Oryx's automatic install, instead of re-running `npm ci` against a tree Oryx has modified. The runner retains its clean install and build. The reported @emnapi lockfile error is not claimed reproduced locally; the redundant clean-install command that raised it is removed from the Oryx phase. The consumer test now executes the automatic-install/custom-build sequence as well. Related init/package-manager tests: 74 passed. The packed pnpm 12 TypeScript consumer passed init, scaffold, verify, build, MCP, CI npm conversion/install/build, and the additional npm install → generated app_build_command sequence. Evidence: /tmp/swallowkit-consumer-pnpm-12-g6SjGa (Node 24.20.0); 24-npm.log and 25-bash.log cover the additional sequence. Node 22 selection is validated through the generated manifest range; this local replay did not execute the actual SWA container or deploy to Azure.

## Reproduction and root causes

An isolated copy of the original Git HEAD (`6a87bed68be18b57e7f19d3426f14d21394138cb`) was built and packed. A temporary HTTP registry served that archive as `swallowkit@1.0.0-beta.60`; other dependencies resolved from npm. Each consumer run used a fresh HOME, config, cache, store, empty npm user/global config, and a PATH without repository node_modules. The artifact did not use the checkout's lockfile or dependencies at execution time.

- pnpm **11.0.0** reproduced `ERR_PNPM_IGNORED_BUILDS: esbuild@0.28.2` during `dlx … --help`, before init could run. Evidence: `/tmp/swallowkit-consumer-pnpm-11.0.0-5hZDAW/4-pnpm.log`.
- pnpm **11.26.0** did not reproduce that failure with the same original dependency declarations. Its installed tree still contained `tsx@4.23.13`, `esbuild@0.28.2`, Next.js, React, and sharp. Passing a recent pnpm patch alone would therefore not prove the dependency defect fixed.
- Unconditional pnpm preference over the npm invocation, an implicit create-next-app manager, duplicate npm/pnpm lockfiles, incorrect filter placement, and commands recommending ephemeral CLI resolution made the generated workflow unpredictable.
- `create-next-app` installed before the complete workspace and security configuration existed. The old recovery code automatically approved every reported build script in noninteractive environments.
- npm's explicit `npx --package swallowkit …` bootstrap also exposed inherited package-selection options in nested npx execution. The nested create-next-app launcher now explicitly selects its own package and binary.
- Root BFF/auth code directly imports Zod; it must be declared at the root instead of relying on the shared workspace's transitive visibility.

## Dependency and artifact decisions

| Runtime dependency | Reason retained |
| --- | --- |
| `@azure/cosmos` | Exported database API, development database setup and seed operations |
| `@modelcontextprotocol/sdk` | MCP stdio server and tools |
| `commander` | CLI parsing |
| `execa` | MCP invokes its matching packaged machine CLI |
| `jsonwebtoken` | Connector/auth development mock server |
| `prompts` | Interactive init and provisioning |
| `typescript` | Compiler-based model transpilation; pure JavaScript, no install script |
| `zod` | Public database/schema API and CLI/MCP validation |

`tsx` is removed. Its native/build-script `esbuild` dependency is absent from consumer CLI trees. TypeScript moves from development-only to runtime dependencies. The parser transpiles modules with the TypeScript compiler, rewrites relative imports using the AST, keeps separate module scopes, then executes `.mjs` with Node. It does not extend the old regex stripping approach. Regression tests exercise Zod 3 and 4, nested/transitive imports and aliasing, interfaces/types/inference, `as const`, default/optional/nullable/enum/array/object fields, connector metadata, auth policy, and partition keys without falling back to regex.

Unused direct `express`/`cors` and their type declarations are removed; the MCP SDK still owns its required transitive HTTP dependencies. Next/React/React DOM peer dependencies are removed: the public exports are database/configuration/types, and framework imports are generated source text. Next is now an explicit development dependency for existing generator build/typecheck tests. VitePress still uses esbuild in the maintainer's development tree; this is not a published runtime dependency.

The package has two tested bins, `swallowkit` and `swallowkit-mcp`, no optional/peer dependency declarations, and no install lifecycle of its own. `dist` and source template assets are packed; actual init exercises their availability. The consumer audit records every installed manifest and its preinstall/install/postinstall/prepare scripts in `dependency-audit.json`, rejecting install hooks and reintroduced CLI framework/esbuild dependencies. The final pnpm 11 tree inventory contained 144 distinct name/version entries (including the dlx wrapper), zero dependency install hooks, and six packages with publishing-only `prepare` scripts. Those prepare scripts do not execute when registry tarballs are installed. No required runtime native installer remained.

Generated applications explicitly deny `protobufjs` and `unrs-resolver` scripts locally. Inspection of their installed scripts showed a version-scheme advisory and a fallback native-binding installer respectively. Prebuilt resolver optional packages are installed normally. Build, typecheck and runtime tests pass with both scripts denied. No global approval, wildcard allow, release-age exemption or trust exemption is added.

## Workspace, commands and CI

- Root install includes shared and TypeScript Functions workspaces. Non-TypeScript backends include only the shared Node workspace.
- Normal commands use `pnpm exec swallowkit` or local `npx swallowkit`. Init installs the exact generating CLI version. MCP resolves latest independently using the chosen package manager, and its machine subprocess uses that same MCP package's CLI.
- Generated Node baseline is 22.14+, with pnpm 11/12 ranges in engines/devEngines. pnpm records the selected manager in its lockfile rather than hardcoding a patch version in the generator.
- GitHub and Azure workflows retain the selected manager. Root installs are frozen. GitHub sets up pnpm before configuring the package cache and selects the correct lockfile.
- Functions deployment staging is an independent temporary production install, as in the pre-existing deployment design. Its pnpm command explicitly uses `--no-frozen-lockfile` because that staging directory has no lockfile. This does not change the frozen root build. The smoke test runs the staging install and loads the copied shared package and Azure SDKs from that directory.
- CI tests pnpm 11.0.0 and current 12, npm, and C#/Python frontend paths. Publishing has pnpm and npm artifact gates. No cloud deployment is triggered by the smoke test.

## Verified results

The revised artifact passed init, frozen root install, create-model, scaffold, machine inspect, frontend build, typecheck, verify, correct lockfile assertions and MCP initialization in these clean environments:

| Node | Manager | Backend | Additional checks |
| --- | --- | --- | --- |
| 24.20.0 | pnpm 11.0.0 | TypeScript | Functions build/deployment staging; frontend HTTP dev |
| 24.20.0 | pnpm 11.26.0 | TypeScript | Functions build |
| 24.20.0 | pnpm 12.3.4 | TypeScript | shared model Node tests; Functions build/deployment staging; frontend HTTP dev; MCP inspect tool |
| 24.20.0 | npm 11.19.0 | TypeScript | Functions build/deployment staging; frontend HTTP dev |
| 24.20.0 | pnpm 11.26.0 | C# | frontend HTTP dev |
| 24.20.0 | pnpm 12.3.4 | Python | frontend HTTP dev |
| 22.23.2 | pnpm 11.0.0 | TypeScript | shared model Node tests; Functions build/staging; frontend HTTP dev; MCP inspect tool |
| 22.23.2 | npm 10.9.9 | TypeScript | shared model Node tests; Functions build/staging; frontend HTTP dev; MCP inspect tool |

Repository checks: TypeScript build passes; 27 Jest suites / 470 tests / 13 snapshots pass; VitePress build passes. The pre-existing proxy-failure tests now use an owned TCP endpoint that resets connections, avoiding reliance on unused ports returning an immediate refusal in a filtered environment while retaining real network failure coverage.

Run the consumer checks after `npm run build`:

```sh
node scripts/consumer-smoke.mjs pnpm 11.0.0 typescript
node scripts/consumer-smoke.mjs pnpm 12 typescript
node scripts/consumer-smoke.mjs npm 10 typescript
node scripts/consumer-smoke.mjs pnpm 11 csharp
node scripts/consumer-smoke.mjs pnpm 12 python
```

The script retains logs in its printed temporary directory. CI uploads logs and dependency inventories. For unpublished versions the isolated registry uses an aged synthetic fixture timestamp; upstream dependency dates and all consumer security settings remain intact. This fixture does not test a production beta becoming eligible under release-age policy.

External services are outside this local smoke: actual Azure deployment, live Cosmos CRUD, Functions Core Tools startup, and C#/Python native backend execution require their respective credentials/services/runtimes. Their package-manager-dependent init, generated frontend, shared schema and verification paths are covered. Fresh releases can legitimately be blocked by user/project security policy; see the [English](../docs/en/package-managers.md) and [Japanese](../docs/ja/package-managers.md) troubleshooting guides.
