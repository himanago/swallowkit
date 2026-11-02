/**
 * Capabilities — 「SwallowKit に何ができるか」の機械可読な自己記述。
 *
 * inspect project/boundaries/infra が「今の状態」を返すのに対し、
 * inspect capabilities は「モデルで宣言できるもの・認証の正しい導入手順・
 * 生成 CRUD の守備範囲・シード適用方法」など、状態に依存しない
 * フレームワーク仕様を返す。Coding Agent がドキュメント外の知識を
 * 推測で埋めるのを構造的に防ぐことが目的。
 */

import { getSwallowKitVersion } from "../../version";

export interface CapabilityModelDeclaration {
  name: string;
  required: boolean;
  description: string;
  format: string;
  notes?: string[];
}

export interface CapabilityAuthProvider {
  provider: string;
  description: string;
  postApplySteps: string[];
}

export interface CapabilitiesContract {
  contractVersion: number;
  swallowkitVersion: string;
  frontends: {
    supported: string[];
    default: string;
    configuration: string;
    reactArchitecture: string;
    development: string;
  };
  modelDeclarations: CapabilityModelDeclaration[];
  authentication: {
    correctWorkflow: string[];
    rules: string[];
    providers: CapabilityAuthProvider[];
    authorizationPolicies: {
      semantics: string;
      configExample: string;
      handEditAllowed: boolean;
    };
  };
  generatedCrud: {
    guarantees: string[];
    notGuaranteed: string[];
    guidance: string[];
  };
  sharedModels: {
    idFieldRule: string;
    buildNote: string;
    nativeSchemaMapping: string[];
  };
  seeding: {
    createTemplates: string;
    applySeeds: string;
    notes: string[];
  };
  machineCommands: string[];
  provisioning: {
    execution: string;
    completion: string;
    tracking: string;
    recovery: string;
    diagnostics: string;
    approval: string;
  };
  verifyChecks: {
    defaultChecks: string[];
    optInChecks: string[];
    customChecks: string;
    backendBuild: string;
  };
}

export function inspectCapabilities(): CapabilitiesContract {
  return {
    contractVersion: 1,
    swallowkitVersion: getSwallowKitVersion(),
    frontends: {
      supported: ["nextjs", "react"],
      default: "nextjs",
      configuration: "init --frontend nextjs|react; stored as frontend.framework in swallowkit.config.js. Missing settings preserve Next.js.",
      reactArchitecture: "React/Vite SPA on SWA -> HTTP-only SWA managed Functions BFF (bff/) -> standalone Functions (functions/). Never link standalone Functions to SWA. Backend keys stay server-side.",
      development: "React dev runs Vite:3000, BFF:7073, Functions:7071 and SWA CLI:4280; use the SWA port for same-origin APIs and authentication. Build/verify include BFF typechecking.",
    },
    modelDeclarations: [
      {
        name: "schema",
        required: true,
        description:
          "Zod object schema; the schema constant and inferred type share the same PascalCase name. The filename-matching export is selected even when helper schemas appear first. `id` MUST be a required string. z.record is currently rejected with file/schema/field diagnostics because its value type is not mapped across every generated target.",
        format:
          "export const Todo = z.object({ id: z.string(), title: z.string().min(1), createdAt: z.string().optional(), updatedAt: z.string().optional() });\nexport type Todo = z.infer<typeof Todo>;",
      },
      {
        name: "displayName",
        required: false,
        description: "Human-readable name used by generated UI. Defaults to the model name.",
        format: "export const displayName = 'Todo';",
      },
      {
        name: "partitionKey",
        required: false,
        description:
          "Cosmos DB partition key path for the generated container. Must start with '/' and reference a field that exists in the schema. Defaults to '/id'.",
        format: "export const partitionKey = '/learnerId';",
        notes: ["The referenced field (e.g. learnerId) must be declared in the Zod schema."],
      },
      {
        name: "authPolicy",
        required: false,
        description:
          "Role-based access control metadata applied to the generated CRUD Functions. `roles` guards all operations; `read`/`write` guard per-operation; `policy` references a named authorization policy from swallowkit.config auth.authorization.policies.",
        format:
          "export const authPolicy = { roles: ['admin'] };\n// or per-operation:\nexport const authPolicy = { read: ['user'], write: ['admin'] };\n// or a named policy:\nexport const authPolicy = { policy: 'adminOnly' };",
        notes: [
          "An explicit authPolicy without configured authentication blocks plan/apply/generate scaffold with auth-policy-without-auth before any artifacts are written. Run plan auth, apply auth, then re-plan scaffold. An empty {} declaration keeps the existing behavior: no explicit policy.",
          "With named auth.schemes, define auth.authorization.policies selecting schemes and roles, then reference them via policy or read/write names. A role-only declaration cannot select a named scheme and blocks with auth-policy-requires-named-policy; it is supported by legacy single-provider authentication.",
          "Conversely, single-provider authentication (auth.provider) supports role lists only. Referencing a named policy (authPolicy.policy, read/write names, or a named auth.authorization.defaultPolicy) blocks with auth-named-policy-requires-named-scheme; add a named scheme first.",
        ],
      },
      {
        name: "references",
        required: false,
        description:
          "Explicit foreign keys used by generated UI lookups. Without it, a string field named <model>Id is treated as a foreign key only when shared/models contains that model (userId -> User only if user.ts exists). Map a field to false to disable inference. References to missing models are ignored with a reference-model-not-found warning.",
        format: "export const references = { authorId: 'User', legacyId: false };",
        notes: ["Only single string id fields can reference a model.", "No lookup UI, fetch, or OpenAPI reference is generated for fields that do not reference an existing model."],
      },
      {
        name: "connectorConfig",
        required: false,
        description:
          "Binds the model to a configured external connector (RDB / API) instead of Cosmos DB. The connector must exist in swallowkit.config connectors.",
        format:
          "export const connectorConfig = {\n  connector: 'mysql',\n  table: 'todos',\n  operations: ['list', 'get', 'create', 'update', 'delete'],\n};",
      },
    ],
    authentication: {
      correctWorkflow: [
        "1. plan auth --provider <custom-jwt|swa|external-token> [--scheme <name>] [--allowed-providers <csv>] — computes the change plan; SwallowKit writes auth.schemes into swallowkit.config for you.",
        "2. apply auth --plan <planId> — generates auth code and appends the scheme to swallowkit.config.",
        "3. Hand-edit swallowkit.config auth.authorization.policies to define named policies (the config is an extension point; this edit is expected).",
        "4. For swa schemes: set swa.allowedProviders via --allowed-providers at plan time, or hand-edit it in the config after apply.",
        "5. For external-token schemes: implement the generated verifier stub — it fails closed (throws) until implemented.",
        "6. Re-run plan/apply scaffold for models that need auth guards, then verify project.",
      ],
      rules: [
        "NEVER hand-write auth.schemes entries in swallowkit.config — plan/apply auth owns them and duplicate names abort with 'already exists'.",
        "authorization.policies and swa.allowedProviders ARE hand-edited after apply (extension-point edits).",
        "Verifier stubs pass typecheck and verify; a passing verify does NOT mean external-token auth works end-to-end.",
      ],
      providers: [
        {
          provider: "custom-jwt",
          description: "Login/logout/me endpoints backed by an RDB user table, bcrypt password check, HS256 JWT.",
          postApplySteps: ["Set JWT_SECRET in functions/local.settings.json.", "Ensure the user table matches auth.customJwt config."],
        },
        {
          provider: "swa",
          description: "Azure Static Web Apps built-in auth (EasyAuth). Principal arrives via x-ms-client-principal.",
          postApplySteps: [
            "Set swa.allowedProviders (e.g. ['github']) via --allowed-providers or by hand-editing the config; generated login URLs use the first entry.",
          ],
        },
        {
          provider: "external-token",
          description: "Bearer tokens issued by an external IdP (LINE, Auth0, ...). SwallowKit generates a fail-closed verifier stub.",
          postApplySteps: [
            "Implement the generated verifier (extension point / generated-once; edit freely).",
            "Implement the frontend token adapter (lib/auth/**/token-adapter.ts).",
          ],
        },
        {
          provider: "none",
          description: "Disables authentication in the config.",
          postApplySteps: [],
        },
      ],
      authorizationPolicies: {
        semantics:
          "A named policy lists which schemes may satisfy it and which roles are required. Generated guards call requireAuth(request, policyName). Exactly one scheme must match the presented credentials.",
        configExample:
          "auth: {\n  schemes: { admin: { provider: 'swa', swa: { allowedProviders: ['github'] } }, api: { provider: 'external-token' } },\n  authorization: {\n    defaultPolicy: 'anonymous',\n    policies: {\n      adminOnly: { schemes: ['admin'], roles: ['administrator'] },\n      learner: { schemes: ['api'] },\n    },\n  },\n}",
        handEditAllowed: true,
      },
    },
    generatedCrud: {
      guarantees: [
        "Generated CRUD endpoints enforce the model's authPolicy (authentication + role checks).",
        "Zod validation runs before persistence.",
      ],
      notGuaranteed: [
        "Owner scoping: generated CRUD does NOT restrict rows to the authenticated principal. Any authenticated caller passing the policy can read/write any document.",
        "Without authentication, plan scaffold reports user-scoped-data-without-auth when the partition key or an owner-like field (userId, learnerId, ownerId, ...) suggests per-user data.",
      ],
      guidance: [
        "Configure authentication via plan/apply auth before declaring authPolicy. For multi-user data where users may only touch their own records, add ai-authored custom endpoints that derive the scoping key (e.g. learnerId) from the verified principal — never from the request body — and restrict generated write endpoints to admin roles or disable them.",
      ],
    },
    sharedModels: {
      idFieldRule: "id: z.string() (required). createdAt/updatedAt: z.string().optional(). The backend owns their values.",
      nativeSchemaMapping: [
        "C#/Python schema assets derive types from Zod, never from field names: z.string() -> string/str (including createdAt/updatedAt).",
        "Date types only when declared: z.iso.datetime() -> DateTime/datetime, z.iso.date() -> DateOnly/date, z.date() -> DateTime/datetime.",
        "z.number() -> double / float|int; z.number().int() or z.int() -> long / int.",
        "Inline z.object({...}) fields become named classes <Model><Field> (e.g. ProbeItemNested); imported model schemas keep their own class.",
        "min/max/length/nonempty/regex/int/gt/gte/lt/lte/positive/nonnegative and array min/max are enforced by C# IValidatableObject.Validate and Python Field bounds/validators. Regexes use search semantics like Zod.",
        "String formats (email/uuid/url), refinements, and transforms are not re-implemented natively; the BFF Zod schemas remain the authoritative validation.",
      ],
      buildNote:
        "create-model writes a new persistent model, its missing shared/index.ts export, and a registered Cosmos container migration with artifact ownership/fingerprints in one staged operation. Connector models do not get Cosmos containers. For a hand-written model, migrations add-model registers only the container and never edits the schema; --dry-run writes nothing. After editing a generated model's partition key, use --refresh-pending with the target resource group; it only refreshes a generated migration when Azure migration tags/checksums, complete deployment history, and the generated file's ownership fingerprint prove that no deployment was applied or attempted. Applied, attempted, unknown, or modified state blocks. verify typecheck resolves the shared package from its built dist/; a passing verify is not proof that required pending infrastructure has been provisioned.",
    },
    seeding: {
      createTemplates: "swallowkit create-dev-seeds <environment> — writes dev-seeds/<environment>/<model>.json templates.",
      applySeeds: "swallowkit dev --seed-env <environment> — applies the seed JSON to the local Cosmos DB emulator at dev startup.",
      notes: ["Editing dev-seeds/*.json alone does nothing; seeds are only applied via dev --seed-env."],
    },
    machineCommands: [
      "inspect project | entities | routes | artifacts | boundaries | infra | drift | capabilities; inspect provision --plan <runId> [--wait-seconds <0-3600>]",
      "validate project",
      "generate model <names...> | generate scaffold <model>",
      "migrations add-model <model> [--dry-run] [--refresh-pending --resource-group <rg> [--subscription <id>]] — register a handwritten model without changing its schema; pending refresh is allowed only after Azure tag/checksum, complete deployment history, and generated-file fingerprints prove it safe",
      "plan model <names...> [--models-dir <dir>] [--connector <name>] [--overwrite never|always] | plan model-infrastructure <model> [--refresh-pending --resource-group <rg> [--subscription <id>]] | plan scaffold <models...> [--api-only] [--skip-infra] | plan auth --provider <p> [--scheme <name>] [--allowed-providers <csv>] | plan provision -g <rg> --location <loc> --swa-location <loc> [--adopt-existing --baseline 0 --what-if] [--reconcile --what-if] [--resume-deployment <name>]",
      "apply model --plan <id> [--approve] | apply scaffold [models...] --plan <id> [--approve] [--skip-infra] | apply auth --plan <id> [--approve] | apply provision --plan <id> --approve [--wait-seconds <0-3600>] (also resumes the same execution checkpoint)",
      "verify project [--checks <ids>] [--compact]",
      "explain failure [--check <id>]",
      "(regular CLI) configure-mcp [--version auto|latest|<semver>] — re-select the MCP launcher version in .mcp.json",
    ],
    provisioning: {
      execution: "Submit Bicep once with az deployment group create --no-wait, then bounded state polling (default 300 seconds, configurable 0-3600) for machine/MCP; the human `swallowkit provision` command waits until Azure reaches a terminal state. Azure CLI invocations are bounded separately. Warning-only stderr with exit 0 is not a failure; output capture limits do not terminate az.",
      completion: "status complete/outcome succeeded requires Azure Succeeded plus verified migration tags and local ledger completion. Running/Accepted -> in-progress; unreadable/not-found state -> blocked/outcome unknown; bookkeeping interruption after Azure Succeeded -> blocked/outcome partial; Failed/Canceled -> failed with Azure causes.",
      tracking: "Approved runs persist before Azure writes under .swallowkit/state/provision/. runId equals the original planId and preserves the subscription, RG, deployment ID/correlation, fingerprints and migration state. inspect provision is read-only; apply provision --plan resumes without re-submitting attempted deployments. Ctrl+C/termination may leave Azure running; never cancel/delete without explicit consent.",
      recovery: "For an older untracked baseline, plan provision --resume-deployment <name> compares the existing ARM template and non-secure parameters to the local Bicep/parameters. It observes that deployment and only tags/records it after Succeeded. Mismatches, unreadable evidence, secure parameters or non-baseline migrations block; do not use reconcile just to repair bookkeeping.",
      diagnostics: "Machine/MCP results include bounded/redacted stdout/stderr, omitted-output flags, exit code, signal, failure kind, elapsed time and deployment identity, but no deployment outputs. Normal CLI shows named resource information and CI/CD setup guidance after success. Never print --debug output, keys, tokens or connection strings.",
      approval: "Machine/MCP initial apply and every resume require explicit human approval. A human invoking normal provision or provision --resume explicitly requests execution without another confirmation prompt. Agents must not switch to normal CLI to bypass approval. A passing local command or an ok envelope is not proof of completed Azure provisioning; inspect status, outcome and nextActions.",
    },
    verifyChecks: {
      defaultChecks: ["structure", "drift", "typecheck", "backend-build"],
      optInChecks: ["build", "lint", "test"],
      customChecks: "swallowkit.config verify.checks: [{ id, command, title?, timeoutMs? }]",
      backendBuild: "Runs dotnet build in functions/ (C#), the project tsc --noEmit (TypeScript), or Python 3 compileall (syntax only, using functions/.venv before PATH). Missing toolchains are skip with a reason, not proof of validation. Root build scripts do not replace backend-build; use --checks \"structure,drift,typecheck,backend-build,build\" for both.",
    },
  };
}
