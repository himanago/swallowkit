import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  FileOperationSession,
  hashContent,
  runWithFileSession,
  getActiveFileSession,
} from "../core/operations/file-session";

describe("FileOperationSession", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-session-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes files to disk in commit mode and records create operations", () => {
    const session = new FileOperationSession("commit", tempDir);
    const target = path.join(tempDir, "nested", "dir", "file.ts");

    const op = session.writeFile(target, "export const a = 1;\n", {
      ownership: "managed",
      generator: "scaffold",
      sourceModel: "Todo",
    });

    expect(fs.readFileSync(target, "utf-8")).toBe("export const a = 1;\n");
    expect(op.action).toBe("create");
    expect(op.path).toBe("nested/dir/file.ts");
    expect(op.previousHash).toBeNull();
    expect(op.newHash).toBe(hashContent("export const a = 1;\n"));
  });

  it("does not touch the disk in collect mode", () => {
    const session = new FileOperationSession("collect", tempDir);
    const target = path.join(tempDir, "virtual.ts");

    session.writeFile(target, "content", { ownership: "managed", generator: "scaffold" });

    expect(fs.existsSync(target)).toBe(false);
    expect(session.operations).toHaveLength(1);
    expect(session.operations[0].action).toBe("create");
    // overlay read-back
    expect(session.readFile(target)).toBe("content");
    expect(session.fileExists(target)).toBe(true);
  });

  it("records skip when content is unchanged", () => {
    const target = path.join(tempDir, "same.ts");
    fs.writeFileSync(target, "unchanged\n", "utf-8");

    const session = new FileOperationSession("commit", tempDir);
    const op = session.writeFile(target, "unchanged\n", { ownership: "managed", generator: "scaffold" });

    expect(op.action).toBe("skip");
  });

  it("records append for extension-point modifications and modify for managed", () => {
    const extensionTarget = path.join(tempDir, "ext.ts");
    const managedTarget = path.join(tempDir, "managed.ts");
    fs.writeFileSync(extensionTarget, "base\n", "utf-8");
    fs.writeFileSync(managedTarget, "base\n", "utf-8");

    const session = new FileOperationSession("commit", tempDir);
    const appendOp = session.writeFile(extensionTarget, "base\nmore\n", {
      ownership: "extension-point",
      generator: "scaffold",
    });
    const modifyOp = session.writeFile(managedTarget, "regenerated\n", {
      ownership: "managed",
      generator: "scaffold",
    });

    expect(appendOp.action).toBe("append");
    expect(modifyOp.action).toBe("modify");
    expect(modifyOp.previousHash).toBe(hashContent("base\n"));
  });

  it("normalizes CRLF for hashing", () => {
    expect(hashContent("a\r\nb\r\n")).toBe(hashContent("a\nb\n"));
  });

  it("scopes the active session with runWithFileSession", async () => {
    expect(getActiveFileSession()).toBeNull();
    const session = new FileOperationSession("collect", tempDir);

    await runWithFileSession(session, async () => {
      expect(getActiveFileSession()).toBe(session);
    });

    expect(getActiveFileSession()).toBeNull();
  });
});
