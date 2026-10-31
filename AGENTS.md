# SwallowKit contributor instructions

This repository implements the SwallowKit CLI, generators, machine interface,
and MCP server. It is not a generated application. Instructions under
`src/core/project/agent-templates/` are templates for consumer projects, not
instructions for modifying this repository.

## Environment safety

- Use the current checkout/worktree only. Do not modify another checkout or
  discard changes made by the user.
- Cosmos DB Emulator may already be running. Check its availability before
  integration tests. If unavailable, report it to the user; never start,
  restart, install, reconfigure, or reset the emulator without explicit consent.
- Do not stop unrelated processes, change machine-wide settings, install
  global tools, or change TLS/certificate trust to make a check pass.
- Use an isolated test database and ports. Never clear or seed an existing
  application database. `dev --seed-env` replaces data; do not use it against
  user data.
- Do not provision/deploy Azure resources or incur cloud costs without
  explicit approval. Never print or commit credentials.
- Keep temporary consumer projects inside the current worktree or the session
  artifact directory. Clean up only specific files/directories created for
  the check, and stop only processes started for that check.

## Architecture to preserve

- `shared/models` in generated projects is the Zod source of truth.
- Support both Next.js and React frontends; preserve Next.js as the default
  for existing configurations without a frontend setting.
- React uses a static SPA on Azure Static Web Apps (SWA) and HTTP-only managed
  Functions as its BFF. Next.js uses its API routes as the BFF.
- Standalone `functions/` owns business logic, Cosmos access, connectors, and
  backend authentication/authorization, independently of the frontend choice
  and backend language (TypeScript, C#, Python).
- Do not link the standalone Functions app to SWA. Browser requests go to the
  same-origin BFF; only the BFF calls standalone Functions using server-side
  settings and a Functions key in production.
- Do not expose backend URLs, keys, database credentials, or server helpers
  through client bundles or `VITE_*` environment variables.

## Change all relevant surfaces

Trace changes through `src/cli/commands`, `src/core/scaffold`,
`src/core/operations`, project manifest/validation, and the machine/MCP
interfaces. Plan/apply and dry-run must use the same generation path as the
interactive CLI and retain ownership, fingerprint, and approval checks.

For new frontend behavior, cover init flags/prompts and configuration defaults,
UI and BFF generation, authentication and connectors, local dev orchestration,
SWA configuration, infrastructure and CI/CD output, and AI instruction templates.
Reuse existing generators where practical. Do not add a parallel source of
truth for shared schemas or duplicate backend business logic in the BFF.

Update directly related English and Japanese documentation. Keep generated
agent instructions accurate for the selected frontend; never confuse those
templates with this contributor contract.

## Development and verification

- Use the repository's npm lockfile. Restore dependencies with `npm ci` when
  needed; do not add another package manager's lockfile.
- `npm run build` compiles the CLI/library into `dist/`.
- `npm test -- --runInBand --runTestsByPath <test files>` runs focused Jest
  coverage. Prefer focused tests first, then broaden when shared code changes.
  If Windows path separators prevent discovery, use
  `node .\node_modules\jest\bin\jest.js --runInBand --testMatch '**/*.test.ts' --testPathPattern '<pattern>'`.
- `npm run lint` checks repository TypeScript.
- `npm run docs:build` checks the VitePress documentation.
- `src/__tests__/generated-project-matrix.test.ts` is the regression gate for
  generated code. It builds `init` skeletons for every frontend × backend ×
  authentication × `authPolicy` combination, runs plan/apply scaffold, and then
  compiles the result (TypeScript type-check of Functions/BFF/UI, Python parse
  plus local-import and `requirements.txt` resolution, C# `dotnet build`). Each
  combination must either be blocked before any write or produce code that
  compiles, re-plans as a no-op, and declares every imported package.
  When adding a generator, provider, option, or prerequisite error, add the
  combination and its expected outcome to this matrix rather than asserting on
  generated strings alone. Run it with
  `node .\node_modules\jest\bin\jest.js --runInBand --testMatch '**/*.test.ts' --testPathPattern generated-project-matrix`;
  `SWALLOWKIT_TEST_SKIP_DOTNET=1` skips the slower C# builds locally,
  `SWALLOWKIT_KEEP_MATRIX=1` keeps the generated projects for inspection, and CI
  sets `SWALLOWKIT_REQUIRE_TOOLCHAINS=1` so a missing Python/.NET fails instead
  of skipping.
- `node dist/cli/index.js ...` exercises this checkout's built CLI, not a
  published SwallowKit release.
- Validate generated consumer applications too: build shared schemas first,
  typecheck/build the frontend and BFF, and build the TypeScript backend (or use
  the existing native toolchain for C#/Python). A passing toolkit build alone
  does not prove its generated code works.
- In a generated consumer, run `swallowkit machine verify project` using this
  checkout's CLI. Inspect plan/apply, routes, drift, and boundaries as relevant.
  Confirm authenticated flows and CRUD behavior, not just HTTP server readiness.
- `npm run test:consumer` is an extended test that downloads dependencies and
  creates consumer projects. Inspect `scripts/consumer-smoke.mjs` before using
  it; choose the package manager/backend under test deliberately. The script's
  extended process-group smoke test targets Unix CI. Append `--frontend react`
  to cover React (Core Tools must already be installed); the default is Next.js.

Report unavailable prerequisites and unverified behavior plainly. Never claim
Azure deployment or live Cosmos integration was verified when only generated
files, mocks, typechecks, or builds were checked.
