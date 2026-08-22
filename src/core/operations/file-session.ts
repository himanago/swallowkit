/**
 * FileOperationSession — SwallowKit generator 由来のファイル書き込みを一元管理する抽象。
 *
 * - mode "commit": 従来どおりディスクへ書き込みつつ、操作を記録する。
 * - mode "collect": ディスクへは一切書き込まず、仮想オーバーレイ上で操作を収集する(Plan / dry-run 用)。
 *
 * すべての生成物には Artifact Ownership を付与し、Plan/Apply/Drift 検出の基礎データとする。
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export type FileSessionMode = "commit" | "collect";

export type ArtifactOwnership =
  | "managed"
  | "generated-once"
  | "user-owned"
  | "extension-point"
  | "metadata";

export type FileSessionActionKind = "create" | "modify" | "append" | "delete" | "skip";

export interface FileWriteMeta {
  ownership: ArtifactOwnership;
  generator: string;
  sourceModel?: string;
}

export interface RecordedFileOperation {
  /** Project-relative POSIX path */
  path: string;
  absolutePath: string;
  action: FileSessionActionKind;
  ownership: ArtifactOwnership;
  generator: string;
  sourceModel?: string;
  existedBefore: boolean;
  /** sha256 (LF normalized) of on-disk content before the session touched the file */
  previousHash: string | null;
  /** sha256 (LF normalized) of the new content; null for delete */
  newHash: string | null;
}

export function normalizeContentForHash(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(normalizeContentForHash(content), "utf-8").digest("hex");
}

export function hashFileIfExists(absolutePath: string): string | null {
  try {
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return null;
    }
    return hashContent(fs.readFileSync(absolutePath, "utf-8"));
  } catch {
    return null;
  }
}

export function toProjectRelativePath(rootDirectory: string, absolutePath: string): string {
  const relative = path.relative(rootDirectory, absolutePath);
  return relative && !relative.startsWith("..")
    ? relative.replace(/\\/g, "/")
    : absolutePath.replace(/\\/g, "/");
}

export class FileOperationSession {
  readonly mode: FileSessionMode;
  readonly rootDirectory: string;
  readonly warnings: string[] = [];

  private readonly operationsByPath = new Map<string, RecordedFileOperation>();
  private readonly inputFingerprintsByPath = new Map<string, string | null>();
  /** overlay: absolute normalized path -> content (null = deleted in session) */
  private readonly overlay = new Map<string, string | null>();

  constructor(mode: FileSessionMode, rootDirectory: string = process.cwd()) {
    this.mode = mode;
    this.rootDirectory = rootDirectory;
  }

  get operations(): RecordedFileOperation[] {
    return Array.from(this.operationsByPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  get inputFingerprints(): Record<string, string | null> {
    return Object.fromEntries(
      Array.from(this.inputFingerprintsByPath.entries()).sort(([left], [right]) => left.localeCompare(right))
    );
  }

  addWarning(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  registerInput(absolutePath: string): void {
    const relativePath = toProjectRelativePath(this.rootDirectory, absolutePath);
    this.inputFingerprintsByPath.set(relativePath, hashFileIfExists(absolutePath));
  }

  private overlayKey(absolutePath: string): string {
    return path.resolve(absolutePath);
  }

  fileExists(absolutePath: string): boolean {
    const key = this.overlayKey(absolutePath);
    if (this.overlay.has(key)) {
      return this.overlay.get(key) !== null;
    }
    return fs.existsSync(absolutePath);
  }

  readFile(absolutePath: string): string {
    const key = this.overlayKey(absolutePath);
    if (this.overlay.has(key)) {
      const content = this.overlay.get(key);
      if (content === null || content === undefined) {
        throw new Error(`File was deleted in this session: ${absolutePath}`);
      }
      return content;
    }
    return fs.readFileSync(absolutePath, "utf-8");
  }

  writeFile(absolutePath: string, content: string, meta: FileWriteMeta): RecordedFileOperation {
    const key = this.overlayKey(absolutePath);
    const relativePath = toProjectRelativePath(this.rootDirectory, absolutePath);
    const existing = this.operationsByPath.get(relativePath);

    const existedBefore = existing ? existing.existedBefore : fs.existsSync(absolutePath);
    const previousHash = existing ? existing.previousHash : hashFileIfExists(absolutePath);
    const newHash = hashContent(content);

    let action: FileSessionActionKind;
    if (!existedBefore) {
      action = "create";
    } else if (newHash === previousHash) {
      action = "skip";
    } else if (meta.ownership === "extension-point") {
      action = "append";
    } else {
      action = "modify";
    }

    const operation: RecordedFileOperation = {
      path: relativePath,
      absolutePath,
      action,
      ownership: meta.ownership,
      generator: meta.generator,
      sourceModel: meta.sourceModel ?? existing?.sourceModel,
      existedBefore,
      previousHash,
      newHash,
    };
    this.operationsByPath.set(relativePath, operation);
    this.overlay.set(key, content);

    if (this.mode === "commit" && action !== "skip") {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, "utf-8");
    }

    return operation;
  }

  deleteFile(absolutePath: string, meta: FileWriteMeta): RecordedFileOperation | null {
    if (!this.fileExists(absolutePath)) {
      return null;
    }

    const key = this.overlayKey(absolutePath);
    const relativePath = toProjectRelativePath(this.rootDirectory, absolutePath);
    const existing = this.operationsByPath.get(relativePath);

    const operation: RecordedFileOperation = {
      path: relativePath,
      absolutePath,
      action: "delete",
      ownership: meta.ownership,
      generator: meta.generator,
      sourceModel: meta.sourceModel ?? existing?.sourceModel,
      existedBefore: existing ? existing.existedBefore : true,
      previousHash: existing ? existing.previousHash : hashFileIfExists(absolutePath),
      newHash: null,
    };
    this.operationsByPath.set(relativePath, operation);
    this.overlay.set(key, null);

    if (this.mode === "commit" && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    return operation;
  }
}

let activeSession: FileOperationSession | null = null;

export function getActiveFileSession(): FileOperationSession | null {
  return activeSession;
}

export async function runWithFileSession<T>(
  session: FileOperationSession,
  action: () => Promise<T>
): Promise<T> {
  const previous = activeSession;
  activeSession = session;
  try {
    return await action();
  } finally {
    activeSession = previous;
  }
}
