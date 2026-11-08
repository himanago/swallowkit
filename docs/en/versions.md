# Documentation versions

This site documents SwallowKit **2.x**, currently based on `2.0.0-beta.3`.
2.x is a prerelease and differs from the stable **1.x** release selected by npm's `latest` tag.
Do not apply these instructions unchanged to a project created with 1.x.

## Choose a release line

| Release line | npm tag | Documentation |
| --- | --- | --- |
| Stable 1.x | `latest` | Outside this site's scope. Use the documentation for your installed version. |
| Prerelease 2.x | `beta` | Covered by this site. React + Vite and its SWA managed Functions BFF are available starting in 2.x. |

Next.js remains the default. Existing configurations without `frontend.framework` retain Next.js.
To select React, initialize with 2.x and pass `--frontend react`.

## Create a 2.x project

```sh
npx swallowkit@beta init my-app --frontend react --package-manager npm
cd my-app
npx swallowkit --version
```

For pnpm, initialize with `pnpm dlx swallowkit@beta init my-app --frontend react --package-manager pnpm`.
Inside the project, use `pnpm exec swallowkit ...`.
An initial `npx swallowkit@beta init` or `pnpm dlx swallowkit@beta init` without `@beta` selects the stable npm release.

For a reproducible version, replace `@beta` with `@2.0.0-beta.3`.
Running `init` again in an existing 1.x project is not a migration procedure. Review dependency,
configuration, and generated-file differences, then validate the migration on a separate branch.

## Check your installed version

Run `npx swallowkit --version` or `pnpm exec swallowkit --version` from the project root.
Use `npm view swallowkit dist-tags` to inspect the published release lines.
The MCP server may use a different version; see [MCP version selection](./ai-mcp-guide.md#mcp-version-selection).

For 1.x, see the [1.x documentation source](https://github.com/himanago/swallowkit/tree/maintenance/1.x/docs).
This site's examples do not promise compatibility with 1.x commands or generated applications.
