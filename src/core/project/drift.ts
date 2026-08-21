/**
 * Drift Detection — 生成物と現在のプロジェクト状態の乖離を検出する。
 *
 * 検出対象:
 * - schema-drift:       スキーマ変更後に生成物が再生成されていない
 * - generator-drift:    Generator (SwallowKit) のバージョンが生成時から変わっている
 * - artifact-modified:  生成後にファイルが手動変更されている(再生成で失われる可能性)
 * - artifact-missing:   台帳に記録された生成物が存在しない
 * - manifest-drift:     Manifest と実際のプロジェクト構造が一致していない
 */

import * as path from "path";
import { getSwallowKitVersion } from "../../version";
import { hashFileIfExists } from "../operations/file-session";
import { ArtifactRecord, loadArtifactLedger } from "./artifacts";
import { buildProjectManifest, readProjectManifest, SWALLOWKIT_MANIFEST_PATH } from "./manifest";

export type DriftKind =
  | "schema-drift"
  | "generator-drift"
  | "artifact-modified"
  | "artifact-missing"
  | "manifest-drift";

export type DriftSeverity = "error" | "warning" | "info";

export interface DriftFinding {
  kind: DriftKind;
  severity: DriftSeverity;
  message: string;
  path?: string;
  entity?: string;
  expected?: string;
  actual?: string;
  repairAction: string;
}

export interface DriftDetectionResult {
  ledgerFound: boolean;
  findings: DriftFinding[];
  checkedArtifacts: number;
}

function detectArtifactDrift(
  record: ArtifactRecord,
  projectRoot: string,
  findings: DriftFinding[]
): void {
  const absolutePath = path.join(projectRoot, record.path);
  const currentHash = hashFileIfExists(absolutePath);

  if (currentHash === null) {
    findings.push({
      kind: "artifact-missing",
      severity: "warning",
      message: `Generated artifact is missing: ${record.path}`,
      path: record.path,
      entity: record.sourceModel,
      expected: record.contentHash,
      actual: "missing",
      repairAction: record.sourceModel
        ? `Run "swallowkit machine apply scaffold ${record.sourceModel}" to regenerate the artifact.`
        : "Re-run the SwallowKit generator that produced this artifact.",
    });
    return;
  }

  if (currentHash !== record.contentHash) {
    const isUserEditable = record.ownership === "user-owned" || record.ownership === "generated-once";
    findings.push({
      kind: "artifact-modified",
      severity: isUserEditable ? "info" : "warning",
      message: isUserEditable
        ? `${record.ownership} artifact has been edited after generation (expected): ${record.path}`
        : `${record.ownership} artifact has been modified after generation; regenerating will require approval: ${record.path}`,
      path: record.path,
      entity: record.sourceModel,
      expected: record.contentHash,
      actual: currentHash,
      repairAction: isUserEditable
        ? "No action required. Edits to this ownership class are expected."
        : "Keep the customization (plan/apply will flag a conflict) or revert the file to the generated content.",
    });
  }
}

function detectSchemaDrift(
  records: ArtifactRecord[],
  projectRoot: string,
  findings: DriftFinding[]
): void {
  const bySchema = new Map<string, { schemaHash: string; sourceModel?: string; paths: string[] }>();

  for (const record of records) {
    if (!record.schemaHash || !record.sourceModel) continue;
    const key = record.sourceModel;
    const entry = bySchema.get(key) ?? { schemaHash: record.schemaHash, sourceModel: record.sourceModel, paths: [] };
    entry.schemaHash = record.schemaHash;
    entry.paths.push(record.path);
    bySchema.set(key, entry);
  }

  for (const [modelName, entry] of bySchema) {
    // モデルファイルは shared/models/<kebab>.ts 規約
    const kebab = modelName
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase();
    const modelPath = path.join(projectRoot, "shared", "models", `${kebab}.ts`);
    const currentSchemaHash = hashFileIfExists(modelPath);
    if (currentSchemaHash === null) {
      continue; // モデルファイルが見つからない場合は manifest-drift 側で検出される
    }
    if (currentSchemaHash !== entry.schemaHash) {
      findings.push({
        kind: "schema-drift",
        severity: "warning",
        message: `Model "${modelName}" changed after its artifacts were generated (${entry.paths.length} artifact(s) are stale).`,
        path: `shared/models/${kebab}.ts`,
        entity: modelName,
        expected: entry.schemaHash,
        actual: currentSchemaHash,
        repairAction: `Run "swallowkit machine plan scaffold ${kebab}" then apply to regenerate artifacts for ${modelName}.`,
      });
    }
  }
}

function detectGeneratorDrift(records: ArtifactRecord[], findings: DriftFinding[]): void {
  const currentVersion = getSwallowKitVersion();
  const staleVersions = new Map<string, number>();

  for (const record of records) {
    if (record.generatorVersion !== currentVersion) {
      staleVersions.set(record.generatorVersion, (staleVersions.get(record.generatorVersion) ?? 0) + 1);
    }
  }

  for (const [version, count] of staleVersions) {
    findings.push({
      kind: "generator-drift",
      severity: "info",
      message: `${count} artifact(s) were generated with SwallowKit ${version}; current version is ${currentVersion}.`,
      expected: currentVersion,
      actual: version,
      repairAction: "Re-run scaffold for affected models to regenerate artifacts with the current generator version.",
    });
  }
}

async function detectManifestDrift(projectRoot: string, findings: DriftFinding[]): Promise<void> {
  const stored = readProjectManifest(projectRoot);
  if (!stored) {
    return;
  }

  const { manifest: rebuilt } = await buildProjectManifest(projectRoot);
  const sameEntitySet =
    JSON.stringify(stored.entities.map((entity) => entity.name).sort()) ===
    JSON.stringify(rebuilt.entities.map((entity) => entity.name).sort());
  const sameRouteSet =
    JSON.stringify(stored.routes.map((route) => route.name).sort()) ===
    JSON.stringify(rebuilt.routes.map((route) => route.name).sort());

  if (!sameEntitySet || !sameRouteSet) {
    findings.push({
      kind: "manifest-drift",
      severity: "warning",
      message: `${SWALLOWKIT_MANIFEST_PATH} does not match the current project structure.`,
      path: SWALLOWKIT_MANIFEST_PATH.replace(/\\/g, "/"),
      repairAction: "Run any SwallowKit generator command (or scaffold) to refresh the project manifest.",
    });
  }
}

export async function detectDrift(projectRoot: string = process.cwd()): Promise<DriftDetectionResult> {
  const findings: DriftFinding[] = [];
  const ledger = loadArtifactLedger(projectRoot);

  if (ledger) {
    for (const record of ledger.artifacts) {
      detectArtifactDrift(record, projectRoot, findings);
    }
    detectSchemaDrift(ledger.artifacts, projectRoot, findings);
    detectGeneratorDrift(ledger.artifacts, findings);
  } else {
    findings.push({
      kind: "artifact-modified",
      severity: "info",
      message: "No artifact ledger (.swallowkit/artifacts.json) found. Artifact-level drift is unknown for this project.",
      repairAction: "Run scaffold (or apply) once with the current SwallowKit version to initialize the artifact ledger.",
    });
  }

  await detectManifestDrift(projectRoot, findings);

  return {
    ledgerFound: ledger !== null,
    findings: findings.sort((a, b) => a.kind.localeCompare(b.kind) || (a.path ?? "").localeCompare(b.path ?? "")),
    checkedArtifacts: ledger?.artifacts.length ?? 0,
  };
}
