import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

describe("npm release metadata", () => {
  const repository = process.cwd();
  const script = path.join(repository, "scripts", "release-metadata.cjs");
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(repository, ".tmp-release-test-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function run(
    version: unknown,
    options: {
      refType?: string;
      refName?: string;
      lockVersion?: string;
      rootVersion?: string;
      noRootPackage?: boolean;
    } = {}
  ) {
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "swallowkit", version })
    );
    fs.writeFileSync(
      path.join(directory, "package-lock.json"),
      JSON.stringify({
        version: options.lockVersion ?? version,
        packages: options.noRootPackage
          ? {}
          : { "": { version: options.rootVersion ?? version } },
      })
    );
    const outputPath = path.join(directory, "output.txt");
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF_TYPE: options.refType ?? "tag",
        GITHUB_REF_NAME: options.refName ?? `v${version}`,
        GITHUB_OUTPUT: outputPath,
      },
    });
    expect(result.error).toBeUndefined();
    const output = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, "utf8")
      : "";
    return { ...result, output };
  }

  it.each([
    ["2.0.0", "latest"],
    ["2.0.0-alpha.1", "alpha"],
    ["2.0.0-alpha.2", "alpha"],
    ["2.0.0-alpha", "alpha"],
    ["2.0.0-beta.1", "beta"],
    ["2.0.0-beta.12", "beta"],
    ["2.0.0-rc.1", "next"],
    ["2.0.0-next.1", "next"],
    ["2.0.0-alphabet.1", "next"],
    ["2.0.0-0", "next"],
    ["2.0.0+build.1", "latest"],
    ["2.0.0-alpha.1+build.1", "alpha"],
  ])("publishes %s on the %s channel", (version, channel) => {
    const result = run(version);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.output).toBe(`version=${version}\ndist_tag=${channel}\n`);
    expect(result.stdout).toBe(result.output);
  });

  it("supports manual branch dry runs without requiring a release tag", () => {
    const result = run("2.0.0-alpha.1", {
      refType: "branch",
      refName: "main",
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain("dist_tag=alpha\n");
  });

  it.each([
    { refName: "v2.0.0" },
    { refName: "2.0.0-alpha.1" },
    { lockVersion: "1.1.2" },
    { rootVersion: "1.1.2" },
    { noRootPackage: true },
  ])("rejects inconsistent release metadata: %j", (options) => {
    const result = run("2.0.0-alpha.1", options);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must match");
    expect(result.output).toBe("");
  });

  it.each([
    undefined,
    2,
    "",
    "v2.0.0-alpha.1",
    "2.0",
    "02.0.0",
    "2.0.0-",
    "2.0.0-alpha.01",
    "2.0.0-alpha..1",
    "2.0.0-alpha_1",
    "2.0.0\n",
    "2.0.0-alpha.1\ndist_tag=latest",
  ])("rejects invalid versions before emitting Actions outputs: %j", (version) => {
    const result = run(version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be a valid SemVer version");
    expect(result.output).toBe("");
  });
});
