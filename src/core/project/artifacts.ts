/**
 * Artifact Ledger — `.swallowkit/artifacts.json`
 *
 * SwallowKit が生成・管理するファイルの所有権(Ownership)、内容ハッシュ、
 * 生成元スキーマのハッシュ、Generator バージョンを記録する台帳。
 * Git 管理を前提とし、Drift 検出と Plan の衝突判定の基礎データとなる。
 */

import * as fs from "fs";
import * as path from "path";
import { getSwallowKitVersion } from "../../version";
import {
  ArtifactOwnership,
  RecordedFileOperation,
  hashFileIfExists,
} from "../operations/file-session";

export const SWALLOWKIT_ARTIFACTS_PATH = path.join(".swallowkit", "artifacts.json");
export const SWALLOWKIT_ARTIFACTS_VERSION = 1;

export type ArtifactLastOperation = "create" | "update" | "append" | "delete";

export interface ArtifactRecord {
  /** Project-relative POSIX path */
  path: string;
  ownership: ArtifactOwnership;
  /** Logical generator name, e.g. "scaffold", "create-model" */
  generator: string;
  generatorVersion: string;
  /** Entity name the artifact was generated from, if any */
  sourceModel?: string;
  /** sha256 (LF normalized) of the source model file at generation time */
  schemaHash?: string;
  /** sha256 (LF normalized) of the artifact content at generation time */
  contentHash: string;
  generatedAt: string;
  lastOperation: ArtifactLastOperation;
}

export interface ArtifactLedger {
  version: number;
  swallowkitVersion: string;
  artifacts: ArtifactRecord[];
}

export function loadArtifactLedger(projectRoot: string = process.cwd()): ArtifactLedger | null {
  const ledgerPath = path.join(projectRoot, SWALLOWKIT_ARTIFACTS_PATH);
  if (!fs.existsSync(ledgerPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as ArtifactLedger;
  } catch {
    return null;
  }
}

export function saveArtifactLedger(ledger: ArtifactLedger, projectRoot: string = process.cwd()): void {
  const ledgerPath = path.join(projectRoot, SWALLOWKIT_ARTIFACTS_PATH);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const sorted: ArtifactLedger = {
    ...ledger,
    swallowkitVersion: getSwallowKitVersion(),
    artifacts: [...ledger.artifacts].sort((a, b) => a.path.localeCompare(b.path)),
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

export function findArtifactRecord(
  ledger: ArtifactLedger | null,
  relativePath: string
): ArtifactRecord | undefined {
  return ledger?.artifacts.find((record) => record.path === relativePath);
}

function toLastOperation(action: RecordedFileOperation["action"]): ArtifactLastOperation | null {
  switch (action) {
    case "create":
      return "create";
    case "modify":
      return "update";
    case "append":
      return "append";
    case "delete":
      return "delete";
    default:
      return null;
  }
}

export interface RecordArtifactContext {
  /** sha256 of the source model file, when the operation batch originates from one model */
  schemaHash?: string;
  /** Fallback source model name */
  sourceModel?: string;
}

/**
 * セッションで記録された操作を台帳へ反映する。
 * - skip は台帳更新しない(既存記録があれば schemaHash のみ更新)
 * - delete は台帳からレコードを削除する
 */
export function recordSessionOperations(
  operations: RecordedFileOperation[],
  context: RecordArtifactContext = {},
  projectRoot: string = process.cwd()
): ArtifactLedger {
  const ledger: ArtifactLedger = loadArtifactLedger(projectRoot) ?? {
    version: SWALLOWKIT_ARTIFACTS_VERSION,
    swallowkitVersion: getSwallowKitVersion(),
    artifacts: [],
  };

  const byPath = new Map(ledger.artifacts.map((record) => [record.path, record] as const));
  const now = new Date().toISOString();
  const generatorVersion = getSwallowKitVersion();

  for (const operation of operations) {
    if (operation.action === "delete") {
      byPath.delete(operation.path);
      continue;
    }

    if (operation.action === "skip") {
      const existing = byPath.get(operation.path);
      if (existing && context.schemaHash) {
        existing.schemaHash = context.schemaHash;
        existing.generatorVersion = generatorVersion;
      } else if (!existing && operation.newHash) {
        // 内容一致でも台帳未登録なら記録し、以後の Drift 検出を可能にする
        byPath.set(operation.path, {
          path: operation.path,
          ownership: operation.ownership,
          generator: operation.generator,
          generatorVersion,
          sourceModel: operation.sourceModel ?? context.sourceModel,
          schemaHash: context.schemaHash,
          contentHash: operation.newHash,
          generatedAt: now,
          lastOperation: "update",
        });
      }
      continue;
    }

    const lastOperation = toLastOperation(operation.action);
    if (!lastOperation || !operation.newHash) {
      continue;
    }

    byPath.set(operation.path, {
      path: operation.path,
      ownership: operation.ownership,
      generator: operation.generator,
      generatorVersion,
      sourceModel: operation.sourceModel ?? context.sourceModel,
      schemaHash: context.schemaHash,
      contentHash: operation.newHash,
      generatedAt: now,
      lastOperation,
    });
  }

  const updated: ArtifactLedger = {
    version: SWALLOWKIT_ARTIFACTS_VERSION,
    swallowkitVersion: generatorVersion,
    artifacts: Array.from(byPath.values()),
  };
  saveArtifactLedger(updated, projectRoot);
  return updated;
}

export interface InspectedArtifact extends ArtifactRecord {
  exists: boolean;
  /** true when the current on-disk content differs from the recorded contentHash */
  modified: boolean;
}

export function inspectArtifacts(projectRoot: string = process.cwd()): {
  ledgerFound: boolean;
  swallowkitVersion: string | null;
  artifacts: InspectedArtifact[];
} {
  const ledger = loadArtifactLedger(projectRoot);
  if (!ledger) {
    return { ledgerFound: false, swallowkitVersion: null, artifacts: [] };
  }

  const artifacts = ledger.artifacts.map((record) => {
    const absolutePath = path.join(projectRoot, record.path);
    const currentHash = hashFileIfExists(absolutePath);
    return {
      ...record,
      exists: currentHash !== null,
      modified: currentHash !== null && currentHash !== record.contentHash,
    };
  });

  return {
    ledgerFound: true,
    swallowkitVersion: ledger.swallowkitVersion,
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
