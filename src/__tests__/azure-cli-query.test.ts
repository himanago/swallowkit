import * as fs from "fs";
import * as path from "path";
import { resolveAzureCliInvocation, runAzureCliQuery } from "../core/operations/azure-cli-query";

const installedMsiDirectory = process.platform === "win32" ? (process.env.PATH ?? "").split(";")
  .map(directory => directory.replace(/^"|"$/g, ""))
  .find(directory => fs.existsSync(path.join(directory, "az.cmd")) &&
    fs.existsSync(path.resolve(directory, "..", "python.exe"))) : undefined;

describe("shell-free refresh Azure queries", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(process.cwd(), ".azure-query-fixture-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("resolves the Windows MSI launcher to bundled Python, never cmd.exe", () => {
    const bin = path.join(root, "MSI fixture with spaces", "wbin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "az.cmd"), "@echo This must never execute");
    fs.writeFileSync(path.join(bin, "..", "python.exe"), "");
    expect(resolveAzureCliInvocation("win32", bin)).toEqual({
      file: path.resolve(bin, "..", "python.exe"), args: ["-IBm", "azure.cli"], installer: "MSI",
    });
    fs.unlinkSync(path.join(bin, "..", "python.exe"));
    expect(() => resolveAzureCliInvocation("win32", bin)).toThrow("no bundled python.exe");
  });

  it("executes a real native subprocess with spaces/metacharacters as literal arguments", () => {
    const bin = path.join(root, "native fixture with spaces");
    fs.mkdirSync(bin);
    const executable = path.join(bin, "az.exe");
    fs.copyFileSync(process.execPath, executable);
    if (process.platform !== "win32") fs.chmodSync(executable, 0o755);
    const script = path.join(bin, "query fixture.cjs");
    fs.writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    const invocation = resolveAzureCliInvocation("win32", bin);
    const args = ["group", "show", "--name", "literal & | %NAME% $(echo bad)", "--subscription", "11111111-1111-1111-1111-111111111111"];
    const result = runAzureCliQuery({ ...invocation, args: [script] }, args);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  (installedMsiDirectory ? it : it.skip)("launches the resolved installed MSI Python in a real subprocess without importing Azure", () => {
    const invocation = resolveAzureCliInvocation("win32", installedMsiDirectory);
    expect(invocation.args).toEqual(["-IBm", "azure.cli"]);
    const result = runAzureCliQuery({
      ...invocation, args: ["-I", "-c", "import json,sys; print(json.dumps(sys.argv[1:]))"],
    }, ["literal & | %NAME%", "path with spaces"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["literal & | %NAME%", "path with spaces"]);
  });
});
