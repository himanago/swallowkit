import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inspectBoundaries } from "../core/project/boundaries";
import { buildSwallowKitConfigSource } from "../cli/commands/init";
import type { BackendLanguage } from "../types";

describe("inspect boundaries convention rules", () => {
  let project: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-boundaries-"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
  });

  it.each<BackendLanguage>(["csharp", "python", "typescript"])("matches the %s backend", (language) => {
    const contract = inspectBoundaries(project, language);
    expect(contract.backendLanguage).toBe(language);
    expect(contract.conventionRules).toMatchSnapshot();
    expect(contract.conventionRules.some((rule) => rule.pattern === "functions/function_app.py")).toBe(language === "python");
  });

  it("resolves the backend language from swallowkit.config", () => {
    fs.writeFileSync(path.join(project, "swallowkit.config.js"), buildSwallowKitConfigSource("csharp", "react"));
    process.chdir(project);
    const contract = inspectBoundaries(project);
    expect(contract.backendLanguage).toBe("csharp");
    expect(contract.conventionRules.map((rule) => rule.pattern)).not.toContain("functions/function_app.py");
  });

  it("orders specific infrastructure rules before the baseline rule", () => {
    const patterns = inspectBoundaries(project, "typescript").conventionRules.map((rule) => rule.pattern);
    expect(patterns.indexOf("infra/migrations/manifest.json")).toBeLessThan(patterns.indexOf("infra/migrations/"));
    expect(patterns.indexOf("infra/migrations/")).toBeLessThan(patterns.indexOf("infra/"));
    expect(patterns[patterns.length - 1]).toBe("*");
  });
});
