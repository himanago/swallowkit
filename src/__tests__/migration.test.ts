import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  checksumAtVersion,
  collectLegacyBaselineFiles,
  createMigrationManifest,
  decodeMigrationState,
  encodeMigrationState,
  getMigrationTagKey,
  findBaselineDrift,
  loadMigrationManifest,
  resolveMigrations,
  saveMigrationManifest,
  selectPendingMigrations,
} from "../core/project/migrations";

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

describe("infrastructure migrations", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-migrations-"));
    writeFile(path.join(projectRoot, "infra", "main.bicep"), "targetScope = 'resourceGroup'\n");
    writeFile(path.join(projectRoot, "infra", "main.parameters.json"), '{"parameters":{}}\n');
    writeFile(path.join(projectRoot, "infra", "modules", "functions.bicep"), "// functions\n");
  });

  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  it("records a deterministic legacy baseline without including migrations", () => {
    writeFile(path.join(projectRoot, "infra", "migrations", "ignored.bicep"), "// ignored\n");

    const first = createMigrationManifest(projectRoot, { legacy: true, projectId: "project-one" });
    const second = createMigrationManifest(projectRoot, { legacy: true, projectId: "project-one" });

    expect(first.baseline.legacy).toBe(true);
    expect(first.baseline.files.map((file) => file.path)).toEqual([
      "infra/main.bicep",
      "infra/main.parameters.json",
      "infra/modules/functions.bicep",
    ]);
    expect(first.baseline.checksum).toBe(second.baseline.checksum);
  });

  it("saves and loads a manifest without overwriting it", () => {
    const manifest = createMigrationManifest(projectRoot, { legacy: true, projectId: "project-one" });
    saveMigrationManifest(manifest, projectRoot);

    expect(loadMigrationManifest(projectRoot)).toEqual(manifest);
    expect(() => saveMigrationManifest(manifest, projectRoot)).toThrow(/already exists/);
  });

  it("computes cumulative checksums and selects only pending migrations", () => {
    const manifest = createMigrationManifest(projectRoot, { projectId: "project-one" });
    writeFile(path.join(projectRoot, "infra", "migrations", "0001-products", "main.bicep"), "resource product 'Example/items@2020-01-01' = {}\n");
    writeFile(path.join(projectRoot, "infra", "migrations", "0002-search", "main.bicep"), "resource search 'Example/search@2020-01-01' = {}\n");
    manifest.migrations = [
      { version: 1, slug: "products", template: "infra/migrations/0001-products/main.bicep", source: "model", sourceModel: "Product" },
      { version: 2, slug: "search", template: "infra/migrations/0002-search/main.bicep", source: "custom" },
    ];

    const resolved = resolveMigrations(manifest, projectRoot);
    const pending = selectPendingMigrations(manifest, {
      schemaVersion: 1,
      version: 1,
      checksum: resolved[0].cumulativeChecksum,
    }, projectRoot);

    expect(resolved[0].checksum).toHaveLength(64);
    expect(resolved[1].cumulativeChecksum).not.toBe(resolved[0].cumulativeChecksum);
    expect(pending.map((migration) => migration.version)).toEqual([2]);
    expect(checksumAtVersion(manifest, 0, projectRoot)).toBe(manifest.baseline.checksum);
  });

  it("rejects gaps, traversal, remote-ahead state, and checksum drift", () => {
    const manifest = createMigrationManifest(projectRoot, { projectId: "project-one" });
    manifest.migrations = [{ version: 2, slug: "bad", template: "../bad.bicep", source: "custom" }];
    expect(() => resolveMigrations(manifest, projectRoot)).toThrow(/contiguous/);

    manifest.migrations = [];
    expect(() => selectPendingMigrations(manifest, {
      schemaVersion: 1,
      version: 1,
      checksum: manifest.baseline.checksum,
    }, projectRoot)).toThrow(/Azure is at migration 1/);
    expect(() => selectPendingMigrations(manifest, {
      schemaVersion: 1,
      version: 0,
      checksum: "0".repeat(64),
    }, projectRoot)).toThrow(/does not match/);
  });

  it("round-trips project-specific Azure tag state", () => {
    const state = { schemaVersion: 1 as const, version: 12, checksum: "a".repeat(64) };
    expect(decodeMigrationState(encodeMigrationState(state))).toEqual(state);
    expect(getMigrationTagKey("project-one")).toMatch(/^swallowkit-migration-[a-f0-9]{12}$/);
    expect(getMigrationTagKey("project-one")).not.toBe(getMigrationTagKey("project-two"));
    expect(() => decodeMigrationState("broken")).toThrow(/invalid/);
  });

  it("collects current baseline file hashes", () => {
    expect(collectLegacyBaselineFiles(projectRoot)).toHaveLength(3);
  });

  it("detects edits to baseline files after initialization", () => {
    const manifest = createMigrationManifest(projectRoot, { projectId: "project-one" });
    writeFile(path.join(projectRoot, "infra", "main.bicep"), "// changed\n");

    expect(findBaselineDrift(manifest, projectRoot)).toEqual(["infra/main.bicep"]);
  });
});
