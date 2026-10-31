import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildBatchCommandLine,
  checkAzCliAvailability,
  resetAzCliInvocationCache,
  resolveAzCliInvocation,
  runAzCli,
  setAzCliInvocationForTesting,
} from "../utils/azure-cli";
import { planProvisionOperation } from "../core/operations/provision-operations";
import { createMigrationManifest, saveMigrationManifest } from "../core/project/migrations";
import { formatCliError } from "../cli";
import { MachineCommandError } from "../machine/errors";

jest.mock("child_process", () => {
  const actual = jest.requireActual<typeof import("child_process")>("child_process");
  return { ...actual, spawnSync: jest.fn(actual.spawnSync) };
});

const spawnSyncMock = jest.mocked(childProcess.spawnSync) as unknown as ReturnType<typeof jest.fn>;

describe("Azure CLI resolution on Windows", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-az-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const touch = (file: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
    return file;
  };

  it("runs the MSI install's bundled Python the same way az.cmd does", () => {
    const wrapper = touch(path.join(root, "CLI2", "wbin", "az.cmd"));
    touch(path.join(root, "CLI2", "wbin", "az"));
    const python = touch(path.join(root, "CLI2", "python.exe"));
    const invocation = resolveAzCliInvocation({ PATH: `${path.join(root, "missing")};${path.dirname(wrapper)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32");
    expect(invocation).toEqual({ command: python, prefixArgs: ["-IBm", "azure.cli"], env: { AZ_INSTALLER: "MSI" }, source: wrapper });
  });

  it("uses an executable directly and other batch wrappers through cmd.exe", () => {
    const exe = touch(path.join(root, "exe", "az.exe"));
    expect(resolveAzCliInvocation({ PATH: path.dirname(exe) }, "win32")).toEqual({ command: exe, prefixArgs: [], source: exe });
    const bat = touch(path.join(root, "venv", "Scripts", "az.bat"));
    expect(resolveAzCliInvocation({ PATH: path.dirname(bat), ComSpec: "C:\\Windows\\system32\\cmd.exe" }, "win32"))
      .toEqual({ command: "C:\\Windows\\system32\\cmd.exe", prefixArgs: [], batchScript: bat, source: bat });
  });

  it("reports not found when PATH has no az, and uses az directly elsewhere", () => {
    expect(resolveAzCliInvocation({ PATH: root }, "win32")).toBeNull();
    expect(resolveAzCliInvocation({ PATH: "/usr/bin" }, "linux")).toEqual({ command: "az", prefixArgs: [], source: "az" });
  });

  it("quotes batch arguments and refuses values cmd.exe would reinterpret", () => {
    expect(buildBatchCommandLine("C:\\Program Files\\az.cmd", ["deployment", "--template-file", "C:\\my app\\main.bicep", "location=japaneast"]))
      .toBe('""C:\\Program Files\\az.cmd" "deployment" "--template-file" "C:\\my app\\main.bicep" "location=japaneast""');
    expect(() => buildBatchCommandLine("az.cmd", ["100%"])).toThrow(/cannot be passed safely/);
    expect(() => buildBatchCommandLine("az.cmd", ['a"b'])).toThrow(/cannot be passed safely/);
  });
});

describe("Azure CLI invocation and availability", () => {
  afterEach(() => {
    resetAzCliInvocationCache();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(jest.requireActual<typeof import("child_process")>("child_process").spawnSync);
  });

  it("never uses a shell and prepends wrapper arguments", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "ok", stderr: "" });
    const invocation = { command: "C:\\CLI2\\python.exe", prefixArgs: ["-IBm", "azure.cli"], env: { AZ_INSTALLER: "MSI" }, source: "az.cmd" };
    expect(runAzCli(["group", "exists", "--name", "rg"], { invocation })).toMatchObject({ status: 0, stdout: "ok" });
    const [command, args, options] = spawnSyncMock.mock.calls[0];
    expect(command).toBe("C:\\CLI2\\python.exe");
    expect(args).toEqual(["-IBm", "azure.cli", "group", "exists", "--name", "rg"]);
    expect(options).toMatchObject({ shell: false, env: expect.objectContaining({ AZ_INSTALLER: "MSI" }) });
  });

  it("runs batch wrappers through cmd.exe with verbatim quoted arguments", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
    runAzCli(["--version"], { invocation: { command: "cmd.exe", prefixArgs: [], batchScript: "C:\\az.bat", source: "C:\\az.bat" } });
    const [command, args, options] = spawnSyncMock.mock.calls[0];
    expect(command).toBe("cmd.exe");
    expect(args).toEqual(["/d", "/s", "/v:off", "/c", '""C:\\az.bat" "--version""']);
    expect(options).toMatchObject({ shell: false, windowsVerbatimArguments: true });
  });

  it("distinguishes a missing CLI from one that cannot start", () => {
    setAzCliInvocationForTesting(null);
    expect(checkAzCliAvailability()).toEqual({ available: false, reason: "not-found", detail: "az was not found on PATH." });

    setAzCliInvocationForTesting({ command: "az", prefixArgs: [], source: "az" });
    spawnSyncMock.mockReturnValue({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn az ENOENT"), { code: "ENOENT" }) });
    expect(checkAzCliAvailability()).toMatchObject({ available: false, reason: "not-found" });

    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "ModuleNotFoundError: azure.cli" });
    expect(checkAzCliAvailability()).toMatchObject({ available: false, reason: "not-runnable", detail: expect.stringContaining("ModuleNotFoundError") });

    spawnSyncMock.mockReturnValue({ status: 0, stdout: "azure-cli 2.70.0", stderr: "" });
    expect(checkAzCliAvailability()).toMatchObject({ available: true });
  });
});

describe("provision planning with Azure CLI state", () => {
  const originalCwd = process.cwd();
  let project: string;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-provision-az-"));
    fs.mkdirSync(path.join(project, "infra"), { recursive: true });
    fs.writeFileSync(path.join(project, "infra", "main.bicep"), "targetScope = 'resourceGroup'\n");
    fs.writeFileSync(path.join(project, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "sample" } } }));
    saveMigrationManifest(createMigrationManifest(project, { projectId: "project" }), project);
    process.chdir(project);
    setAzCliInvocationForTesting({ command: "az", prefixArgs: [], source: "az" });
  });
  afterEach(() => {
    process.chdir(originalCwd);
    resetAzCliInvocationCache();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(jest.requireActual<typeof import("child_process")>("child_process").spawnSync);
    fs.rmSync(project, { recursive: true, force: true });
  });

  const options = { resourceGroup: "rg-sample", location: "japaneast", swaLocation: "eastasia" };

  it("reads Azure state through the resolved CLI and plans a bootstrap", async () => {
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "false\n", stderr: "" };
      return { status: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    });
    const plan = await planProvisionOperation(options);
    expect(plan.azCliAvailable).toBe(true);
    expect(plan.mode).toBe("bootstrap");
    expect(plan.warnings.filter((warning) => warning.startsWith("az-"))).toEqual([]);
    expect(spawnSyncMock.mock.calls.every((call: unknown[]) => (call[2] as { shell?: boolean }).shell === false)).toBe(true);
  });

  it("asks for az login instead of reporting a missing CLI", async () => {
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => args[0] === "--version"
      ? { status: 0, stdout: "azure-cli", stderr: "" }
      : { status: 1, stdout: "", stderr: "ERROR: Please run 'az login' to setup account." });
    await expect(planProvisionOperation(options)).rejects.toMatchObject({ code: "az-not-logged-in", status: "requires-human" });
  });

  it("reports an installed but broken CLI accurately", async () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "Failed to load python executable." });
    const plan = await planProvisionOperation(options);
    expect(plan.mode).toBe("offline");
    expect(plan.warnings.some((warning) => warning.startsWith("az-cli-not-runnable:") && warning.includes("Failed to load python executable."))).toBe(true);
  });
});

describe("regular CLI error output", () => {
  it("prints machine errors without a stack trace", () => {
    const text = formatCliError(new MachineCommandError("online-plan-required", "Cannot apply.", { nextAction: "Run az login." }, "blocked"));
    expect(text).toBe("❌ Cannot apply.\n   (code: online-plan-required)\n   Next: Run az login.");
    expect(formatCliError(new Error("plain failure"))).toBe("❌ plain failure");
  });
});
