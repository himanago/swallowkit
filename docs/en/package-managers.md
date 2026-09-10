# Package managers

Use Node.js 22.14+ (Node 22 and 24 are tested) and pnpm 11/12 or npm 10+. The repository itself remains npm-managed.

| Operation | pnpm | npm |
| --- | --- | --- |
| Bootstrap | `pnpm dlx swallowkit init my-app` | `npx swallowkit init my-app` |
| Model | `pnpm exec swallowkit create-model todo` | `npx swallowkit create-model todo` |
| Scaffold | `pnpm exec swallowkit scaffold todo` | `npx swallowkit scaffold todo` |
| Development | `pnpm exec swallowkit dev` | `npx swallowkit dev` |
| Verify | `pnpm exec swallowkit machine verify project` | `npx swallowkit machine verify project` |
| Build | `pnpm run build` | `npm run build` |
| Reproducible install | `pnpm install --frozen-lockfile` | `npm ci` |

Run project commands after `cd my-app`. The project pins SwallowKit to the version that generated it. `npx` uses that local installation; `npx --no-install swallowkit …` additionally prevents downloading a missing CLI. Global installation is optional and is not used by this workflow.

`init --package-manager npm|pnpm` overrides detection. Otherwise the invocation's user agent wins: `npx` selects npm even if pnpm is installed. When launched directly without a user agent, available pnpm is preferred, then npm. Existing-project commands consult project metadata and lockfiles.

The root install includes `shared/` and, for TypeScript backends, `functions/`. Commit only the selected lockfile. pnpm projects have `pnpm-workspace.yaml`; npm projects have npm workspaces and `package-lock.json`. Generated CI uses the selected manager and frozen root installation. Generated `devEngines.packageManager` uses a supported range, with pnpm recording its selected version in the lockfile; patch versions are not hardcoded. See the [pnpm 11 release specification](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md).

MCP intentionally resolves `swallowkit@latest` using the selected package manager. `.mcp.json` uses pnpm's package/dlx launcher or npm's `npx --yes --package` launcher. This keeps MCP information current independently of the project CLI. An uncached version requires network access; beta updates can differ from the local CLI. For offline/reproducible sessions, set `SWALLOWKIT_MCP_VERSION` in `.mcp.json` to the desired version and cache it beforehand, or use the local machine CLI. Neither npm projects nor their MCP launcher require pnpm.

Azure Functions Core Tools v4 and the backend runtime are separate development prerequisites; SwallowKit does not include their binary installers in its CLI dependency tree. `dev --no-functions --no-swa` can run the frontend alone.

## Build script and supply-chain troubleshooting

The CLI no longer depends on `tsx`/`esbuild`, and its packed runtime dependency tree is checked for install scripts. `ERR_PNPM_IGNORED_BUILDS` mentioning `esbuild` while bootstrapping an older SwallowKit release indicates the old CLI dependency chain; use a release containing this fix.

Generated applications explicitly **deny**, rather than approve, two unnecessary scripts in their project-local `allowBuilds`: `protobufjs` (a version-scheme advisory from Application Insights dependencies) and `unrs-resolver` (a native-binding fallback installer; supported platforms receive the optional prebuilt package). This grants no script execution. Unknown future dependencies still require review; no wildcard approval, global configuration, release-age exemption, or trust-policy exemption is generated.

If installation reports another package, locate it with `pnpm why <package>`, inspect its installed `package.json` and script, and determine whether it is needed for your app/platform. Only approve a reviewed dependency locally if its build is actually required; dependency scripts execute code with your user's permissions. Do not approve every package or disable security controls to finish `init`.

pnpm also applies release-age and trust policies to `dlx`/`create`, including policies inherited from the parent project. A newly published beta or dependency may deliberately be unavailable until its waiting period ends. Wait for eligibility or use an already eligible version; SwallowKit does not bypass these policies. See [pnpm's bootstrap security rules](https://pnpm.io/cli/pnx#security-and-trust-policies).
