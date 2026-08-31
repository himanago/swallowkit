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
  };
  seeding: {
    createTemplates: string;
    applySeeds: string;
    notes: string[];
  };
  machineCommands: string[];
  verifyChecks: {
    defaultChecks: string[];
    optInChecks: string[];
    customChecks: string;
  };
}

export function inspectCapabilities(): CapabilitiesContract {
  return {
    contractVersion: 1,
    swallowkitVersion: getSwallowKitVersion(),
    modelDeclarations: [
      {
        name: "schema",
        required: true,
        description:
          "Zod object schema; the schema constant and the inferred type share the same PascalCase name. `id` MUST be a required string — generated CRUD, UI, and repositories assume it is always present. Only `createdAt` / `updatedAt` are optional (backend-managed).",
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
      ],
      guidance: [
        "For multi-user data where users may only touch their own records, add ai-authored custom endpoints that derive the scoping key (e.g. learnerId) from the verified principal — never from the request body — and restrict generated write endpoints to admin roles or disable them.",
      ],
    },
    sharedModels: {
      idFieldRule: "id: z.string() (required). createdAt/updatedAt: z.string().optional(). The backend owns their values.",
      buildNote:
        "verify typecheck resolves the shared package from its built dist/. SwallowKit rebuilds shared automatically during verify; when typechecking manually, build the shared package first (errors like \"no exported member\" usually mean a stale dist).",
    },
    seeding: {
      createTemplates: "swallowkit create-dev-seeds <environment> — writes dev-seeds/<environment>/<model>.json templates.",
      applySeeds: "swallowkit dev --seed-env <environment> — applies the seed JSON to the local Cosmos DB emulator at dev startup.",
      notes: ["Editing dev-seeds/*.json alone does nothing; seeds are only applied via dev --seed-env."],
    },
    machineCommands: [
      "inspect project | entities | routes | artifacts | boundaries | infra | drift | capabilities",
      "validate project",
      "generate model <names...> | generate scaffold <model>",
      "plan scaffold <models...> | plan auth --provider <p> [--scheme <name>] [--allowed-providers <csv>] | plan provision -g <rg> --location <loc> --swa-location <loc>",
      "apply scaffold [models...] --plan <id> [--approve] | apply auth --plan <id> [--approve] | apply provision --plan <id> --approve",
      "verify project [--checks <ids>] [--compact]",
      "explain failure [--check <id>]",
    ],
    verifyChecks: {
      defaultChecks: ["structure", "drift", "typecheck"],
      optInChecks: ["build", "lint", "test"],
      customChecks: "swallowkit.config verify.checks: [{ id, command, title?, timeoutMs? }]",
    },
  };
}
