# Package managers

Use Node.js 22.14+ and pnpm 11/12 or npm 10+. CI for apps deployed to SWA uses Node.js 22.

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

The root install includes `shared/` and, for TypeScript backends, `functions/`. Commit only the selected lockfile. pnpm projects have `pnpm-workspace.yaml`; npm projects have npm workspaces and `package-lock.json`. Functions CI uses the selected manager and frozen root installation. SWA is an exception: its npm/Oryx deployment tooling requires an npm-compatible CI checkout, described below. Generated `devEngines.packageManager` uses a supported range, with pnpm recording its selected version in the lockfile; patch versions are not hardcoded. See the [pnpm 11 release specification](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md).

MCP intentionally resolves `swallowkit@latest` using the selected package manager. `.mcp.json` uses pnpm's package/dlx launcher or npm's `npx --yes --package` launcher. This keeps MCP information current independently of the project CLI. An uncached version requires network access; beta updates can differ from the local CLI. For offline/reproducible sessions, set `SWALLOWKIT_MCP_VERSION` in `.mcp.json` to the desired version and cache it beforehand, or use the local machine CLI. Neither npm projects nor their MCP launcher require pnpm.

Azure Functions Core Tools v4 and the backend runtime are separate development prerequisites; SwallowKit does not include their binary installers in its CLI dependency tree. `dev --no-functions --no-swa` can run the frontend alone.

## Build script and supply-chain troubleshooting

Starting the SwallowKit CLI does not require approval for an `esbuild` build script. If `init` from an older release reports `ERR_PNPM_IGNORED_BUILDS` for `esbuild`, update SwallowKit and retry.

Generated applications explicitly **deny**, rather than approve, two unnecessary scripts in their project-local `allowBuilds`: `protobufjs` (a version-scheme advisory from Application Insights dependencies) and `unrs-resolver` (a native-binding fallback installer; supported platforms receive the optional prebuilt package). This grants no script execution. Unknown future dependencies still require review; no wildcard approval, global configuration, release-age exemption, or trust-policy exemption is generated.

If installation reports another package, locate it with `pnpm why <package>`, inspect its installed `package.json` and script, and determine whether it is needed for your app/platform. Only approve a reviewed dependency locally if its build is actually required; dependency scripts execute code with your user's permissions. Do not approve every package or disable security controls to finish `init`.

pnpm also applies release-age and trust policies to `dlx`/`create`, including policies inherited from the parent project. A newly published beta or dependency may deliberately be unavailable until its waiting period ends. Wait for eligibility or use an already eligible version; SwallowKit does not bypass these policies. See [pnpm's bootstrap security rules](https://pnpm.io/cli/pnx#security-and-trust-policies).


## SWA deployment from pnpm projects

Continue using pnpm locally. The generated SWA workflow converts files only in the CI checkout to use npm in Azure's build environment. You do not need to change your local `package.json` or `pnpm-lock.yaml`. Functions CI uses the selected package manager.

The workflow constrains `engines.node` to `>=22.14.0 <23` in the CI checkout for SWA. The `actions/setup-node` setting selects the GitHub runner's runtime separately from SWA's runtime. See [Azure's build configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration#custom-build-commands).

The GitHub runner executes `npm ci && npm run build`. The SWA action's `app_build_command` is only `npm run build`. Azure's Oryx build engine installs dependencies first, so do not add `npm ci` to that command. See [Oryx's build sequence](https://github.com/microsoft/Oryx/blob/main/doc/runtimes/nodejs.md#build).

### Troubleshooting existing workflows

Updating the CLI does not automatically update an existing app's workflows. Preserve your app-specific settings and check the following:

| Error | Setting to check |
| --- | --- |
| `EBADDEVENGINES`: npm/pnpm mismatch | Run the CI conversion to npm before the first npm operation. Remove `cache: npm` from setup-node before conversion: even its cache lookup invokes npm. |
| Lockfile mismatch from `npm ci` inside Oryx | Set the SWA `app_build_command` to `npm run build`. Keep the runner's `npm ci`. |
| `Node version 24 … is not supported` | Set `engines.node` to `>=22.14.0 <23` in the `package.json` passed to SWA. |

Disabling the package-manager check alone does not fix incompatible workspace references or build commands. Check the complete npm conversion step.
