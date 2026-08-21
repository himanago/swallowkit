/**
 * Responsibility Boundaries — AI の自由生成と SwallowKit の決定論的処理の責任分界点。
 *
 * Coding Agent / 自律ループが「どこを自由に書いてよいか」「どこは SwallowKit の
 * plan/apply に委ねるべきか」を機械可読な契約として取得できるようにする。
 *
 * zone:
 * - deterministic: SwallowKit が決定論的に生成・再生成する領域。手編集しない。
 * - ai-authored:   AI / 開発者が自由に記述する領域。SwallowKit は上書きしない。
 * - shared:        マーカー区切りの共有領域。マーカー内は SwallowKit、外は自由。
 */

import { ArtifactOwnership } from "../operations/file-session";
import { inspectArtifacts } from "./artifacts";

export type BoundaryZone = "deterministic" | "ai-authored" | "shared";

export type BoundaryEditPolicy =
  | "never-hand-edit"
  | "regenerate-via-plan-apply"
  | "free-edit"
  | "edit-outside-markers";

export interface OwnershipPolicy {
  ownership: ArtifactOwnership;
  zone: BoundaryZone;
  editPolicy: BoundaryEditPolicy;
  howToChange: string;
}

export interface BoundaryPathRule {
  /** Path prefix or glob-like pattern (documentation purpose; matching is prefix-based) */
  pattern: string;
  zone: BoundaryZone;
  editPolicy: BoundaryEditPolicy;
  description: string;
}

export interface BoundaryArtifact {
  path: string;
  ownership: ArtifactOwnership;
  zone: BoundaryZone;
  editPolicy: BoundaryEditPolicy;
  generator: string;
  sourceModel?: string;
}

export interface BoundariesContract {
  contractVersion: number;
  summary: string;
  ownershipPolicies: OwnershipPolicy[];
  /** 台帳に載っていないパスの既定規約 */
  conventionRules: BoundaryPathRule[];
  /** 台帳に記録された生成物ごとの解決結果 */
  artifacts: BoundaryArtifact[];
  guidance: string[];
}

export const OWNERSHIP_POLICIES: OwnershipPolicy[] = [
  {
    ownership: "managed",
    zone: "deterministic",
    editPolicy: "regenerate-via-plan-apply",
    howToChange:
      "Edit the source model (shared/models/*.ts) or configuration, then run `swallowkit machine plan scaffold <model>` and `apply scaffold`. Hand-edits are detected as drift and require --approve to overwrite.",
  },
  {
    ownership: "generated-once",
    zone: "ai-authored",
    editPolicy: "free-edit",
    howToChange: "Generated once as a starting point. Edit freely; SwallowKit never regenerates it.",
  },
  {
    ownership: "user-owned",
    zone: "ai-authored",
    editPolicy: "free-edit",
    howToChange:
      "Owned by the developer/AI. SwallowKit only creates the initial version (e.g. model files). Edit freely; managed artifacts are regenerated from it.",
  },
  {
    ownership: "extension-point",
    zone: "shared",
    editPolicy: "edit-outside-markers",
    howToChange:
      "SwallowKit appends only inside marked sections (e.g. `# SwallowKit scaffold registrations`). Edit anywhere outside the markers freely; do not remove the markers.",
  },
  {
    ownership: "metadata",
    zone: "deterministic",
    editPolicy: "never-hand-edit",
    howToChange: "Managed entirely by SwallowKit tooling (.swallowkit/). Never hand-edit.",
  },
];

export const CONVENTION_RULES: BoundaryPathRule[] = [
  {
    pattern: ".swallowkit/",
    zone: "deterministic",
    editPolicy: "never-hand-edit",
    description: "SwallowKit metadata (manifest, artifact ledger, plan state). Managed by tooling only.",
  },
  {
    pattern: "shared/models/",
    zone: "ai-authored",
    editPolicy: "free-edit",
    description:
      "Zod model schemas — the single source of truth. AI/developers author these freely; deterministic generation derives everything else from them.",
  },
  {
    pattern: "infra/main.bicep",
    zone: "shared",
    editPolicy: "edit-outside-markers",
    description: "SwallowKit inserts container modules; other infrastructure edits are free.",
  },
  {
    pattern: "functions/function_app.py",
    zone: "shared",
    editPolicy: "edit-outside-markers",
    description: "SwallowKit appends blueprint registrations under its marker; other edits are free.",
  },
  {
    pattern: "shared/index.ts",
    zone: "shared",
    editPolicy: "edit-outside-markers",
    description: "SwallowKit appends model exports; other exports may be added freely.",
  },
  {
    pattern: "*",
    zone: "ai-authored",
    editPolicy: "free-edit",
    description:
      "Any path not recorded in the artifact ledger is AI/developer-authored. Business logic, custom pages, custom Functions, and tests belong here.",
  },
];

const POLICY_BY_OWNERSHIP = new Map(OWNERSHIP_POLICIES.map((policy) => [policy.ownership, policy] as const));

export const BOUNDARY_GUIDANCE: string[] = [
  "Author models and business logic freely (ai-authored zone), then let SwallowKit derive CRUD/BFF/UI/infra deterministically via plan/apply.",
  "Never hand-edit deterministic-zone files; change the model or configuration and regenerate instead.",
  "Use `swallowkit machine plan scaffold <model>` before applying; a plan with requiresApproval=true means a human (or explicit --approve) must confirm overwriting hand-edited files.",
  "In shared-zone files, keep SwallowKit markers intact and edit outside them.",
  "Run `swallowkit machine verify project` after applying changes; use `explain failure` to get repair evidence.",
];

export function inspectBoundaries(projectRoot: string = process.cwd()): BoundariesContract {
  const inspected = inspectArtifacts(projectRoot);

  const artifacts: BoundaryArtifact[] = inspected.artifacts.map((artifact) => {
    const policy = POLICY_BY_OWNERSHIP.get(artifact.ownership);
    return {
      path: artifact.path,
      ownership: artifact.ownership,
      zone: policy?.zone ?? "ai-authored",
      editPolicy: policy?.editPolicy ?? "free-edit",
      generator: artifact.generator,
      ...(artifact.sourceModel ? { sourceModel: artifact.sourceModel } : {}),
    };
  });

  return {
    contractVersion: 1,
    summary:
      "SwallowKit separates deterministic generation (models → CRUD/BFF/UI/infra via plan/apply) from AI free-form authoring (models, business logic, custom code). This contract tells agents which files belong to which side.",
    ownershipPolicies: OWNERSHIP_POLICIES,
    conventionRules: CONVENTION_RULES,
    artifacts,
    guidance: BOUNDARY_GUIDANCE,
  };
}
