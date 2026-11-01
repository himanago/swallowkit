import * as fs from "fs";
import * as path from "path";
import * as childProcess from "child_process";
import type { SpiedFunction } from "jest-mock";
import * as migrations from "../core/project/migrations";
import prompts from "prompts";
import { createProvisionCommand } from "../cli/commands/provision";
import { planProvisionOperation } from "../core/operations/provision-operations";
import { createCustomMigration } from "../core/operations/migration-generator";
import { runMachineCli } from "../machine";
import { buildSwallowKitToolDefinitions } from "../mcp";

jest.mock("child_process", () => ({
  ...jest.requireActual<typeof import("child_process")>("child_process"),
  spawnSync: jest.fn(),
}));
jest.mock("prompts", () => jest.fn());

const subscription = "00000000-0000-4000-8000-000000000001";
const token = "fictional-swa-token-for-tests";
const profile = '<publishData><publishProfile profileName="fictional" userPWD="fictional-password" /></publishData>';
const resources = {
  staticWebAppName: "swa-fictional",
  staticWebAppUrl: "https://fictional.example",
  functionsAppName: "func-fictional",
  functionsAppUrl: "https://functions.example",
  cosmosDbAccountName: "cosmos-fictional",
  cosmosDatabaseName: "fictionalDatabase",
};
type AzResponse = { status: number | null; stdout: string; stderr?: string; error?: Error; signal?: NodeJS.Signals | null };
const az = jest.mocked(childProcess.spawnSync as (
  file: string, args: readonly string[]
) => childProcess.SpawnSyncReturns<string>);

describe("stable human provision setup output", () => {
  const cwd = process.cwd();
  let root: string;
  let exists: boolean;
  let tags: Record<string, string>;
  let outputResponse: AzResponse;
  let tokenResponse: AzResponse;
  let profileResponse: AzResponse;
  let failCommand: string | undefined;
  let log: SpiedFunction<typeof console.log>;
  let warn: SpiedFunction<typeof console.warn>;
  const options = { resourceGroup: "rg-fictional", subscription, location: "japaneast", swaLocation: "eastasia" };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(cwd, ".provision-output-test-"));
    process.chdir(root);
    fs.writeFileSync(path.join(root, "swallowkit.config.js"), "module.exports = {};\n");
    fs.mkdirSync(path.join(root, "infra"));
    fs.writeFileSync(path.join(root, "infra", "main.bicep"), "targetScope = 'resourceGroup'\n");
    fs.writeFileSync(path.join(root, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "fictional" } } }));
    migrations.saveMigrationManifest(migrations.createMigrationManifest(root), root);
    exists = false;
    tags = {};
    outputResponse = { status: 0, stdout: JSON.stringify(resources) };
    tokenResponse = { status: 0, stdout: token };
    profileResponse = { status: 0, stdout: profile };
    failCommand = undefined;
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const respond = (args: readonly string[]): AzResponse => {
      const command = args.slice(0, 3).join(" ");
      if (command === failCommand) return { status: 1, stdout: "", stderr: "fictional failure" };
      if (args[0] === "--version") return { status: 0, stdout: "fictional az" };
      if (args[0] === "account") return { status: 0, stdout: subscription };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: String(exists) };
      if (args[0] === "group" && args[1] === "show") return { status: 0, stdout: JSON.stringify({ id: `/subscriptions/${subscription}/resourceGroups/rg-fictional`, tags }) };
      if (args[0] === "group" && args[1] === "create") {
        exists = true;
        return { status: 0, stdout: "{}" };
      }
      if (args[0] === "group" && args[1] === "update") {
        const assignment = args[args.indexOf("--set") + 1];
        const separator = assignment.indexOf("=");
        tags[assignment.slice(5, separator)] = assignment.slice(separator + 1);
        return { status: 0, stdout: "{}" };
      }
      if (args[0] === "tag") {
        const assignment = args[args.indexOf("--tags") + 1];
        const separator = assignment.indexOf("=");
        tags[assignment.slice(0, separator)] = assignment.slice(separator + 1);
        return { status: 0, stdout: "{}" };
      }
      if (command === "deployment group create") return { status: 0, stdout: JSON.stringify({ properties: { outputs: {} } }) };
      if (command === "deployment group what-if") return { status: 0, stdout: '{"changes":[]}' };
      if (command === "deployment group show") {
        // Output/secret retrieval must happen only after the stable apply has
        // committed its manifest and deleted the plan.
        expect(tags).not.toEqual({});
        expect(fs.readdirSync(path.join(root, ".swallowkit", "state", "plans"))).toEqual([]);
        return outputResponse;
      }
      if (command === "staticwebapp secrets list") return tokenResponse;
      if (command === "webapp deployment list-publishing-profiles") return profileResponse;
      throw new Error(`Unexpected mocked command: ${args.join(" ")}`);
    };
    az.mockImplementation((_file, args = []) => ({
      pid: 0, output: [], signal: null, stderr: "", ...respond(args),
    }));
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
    az.mockReset();
  });

  async function human(extra: string[] = [], explicitSubscription = true): Promise<void> {
    await createProvisionCommand().parseAsync([
      "node", "provision", "-g", options.resourceGroup,
      "--location", options.location, "--swa-location", options.swaLocation,
      ...(explicitSubscription ? ["--subscription", subscription] : []), "--approve", ...extra,
    ]);
  }

  function transcript(): string {
    return [...log.mock.calls, ...warn.mock.calls].flat().join("\n");
  }

  function queries(): Array<readonly string[]> {
    return az.mock.calls.map((call) => call[1] ?? []).filter((args) =>
      args[0] === "staticwebapp" || args[0] === "webapp" || args.slice(0, 3).join(" ") === "deployment group show");
  }

  function assertNoSecretsOnDisk(directory = root): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) assertNoSecretsOnDisk(entryPath);
      else {
        const content = fs.readFileSync(entryPath, "utf-8");
        expect(content).not.toContain(token);
        expect(content).not.toContain("fictional-password");
      }
    }
  }

  it("prints all resource fields and CI/CD values only after apply succeeds, scoped to the deployment target", async () => {
    await human();
    for (const value of Object.values(resources)) expect(transcript()).toContain(value);
    for (const label of ["AZURE_STATIC_WEB_APPS_API_TOKEN", "AZURE_FUNCTIONAPP_NAME", "AZURE_FUNCTIONAPP_PUBLISH_PROFILE"]) expect(transcript()).toContain(`[${label}]`);
    expect(transcript()).toContain(token);
    expect(transcript()).toContain(profile);
    expect(transcript()).not.toContain("Run manually");
    expect(queries()).toHaveLength(3);
    for (const args of queries()) {
      expect(args[args.indexOf("--subscription") + 1]).toBe(subscription);
      expect(args[args.indexOf("--resource-group") + 1]).toBe(options.resourceGroup);
    }
    expect(queries()[0]).toEqual(expect.arrayContaining(["--name", "swallowkit-baseline"]));
    expect(queries()[1]).toEqual(expect.arrayContaining(["--query", "properties.apiKey", "-o", "tsv"]));
    expect(queries()[2]).toContain("--xml");
    assertNoSecretsOnDisk();
  });

  it("pins the active subscription before planning when the flag is omitted", async () => {
    await human([], false);
    expect(az.mock.calls[0][1]).toEqual(["account", "show", "--query", "id", "-o", "tsv"]);
    for (const args of queries()) expect(args).toEqual(expect.arrayContaining(["--subscription", subscription]));
  });

  it.each([
    ["failed", { status: 1, stdout: token, stderr: "fictional sensitive diagnostic" }],
    ["missing", { status: 0, stdout: "" }],
    ["null", { status: 0, stdout: "null" }],
    ["truncated", { status: 0, stdout: token, error: new Error("ENOBUFS fictional") }],
    ["interrupted", { status: 0, stdout: token, signal: "SIGTERM" }],
    ["timeout", { status: null, stdout: token, error: new Error("ETIMEDOUT fictional") }],
  ] satisfies Array<[string, AzResponse]>)("shows safe manual commands for %s credential retrieval without leaking partial output", async (_name, response) => {
    tokenResponse = response;
    profileResponse = { ...response, stdout: response.stdout && response.stdout !== "null" ? profile : response.stdout };
    await human();
    expect(transcript()).toContain("Could not retrieve automatically");
    expect(transcript()).toContain("Run manually: az staticwebapp secrets list");
    expect(transcript()).toContain("Run manually: az webapp deployment list-publishing-profiles");
    expect(transcript()).toContain(`--subscription ${subscription}`);
    expect(transcript()).not.toContain(token);
    expect(transcript()).not.toContain(profile);
    expect(transcript()).not.toContain("fictional sensitive diagnostic");
    assertNoSecretsOnDisk();
  });

  it("rejects incomplete XML rather than presenting it as a publish profile", async () => {
    profileResponse.stdout = '<publishData><publishProfile userPWD="fictional-password" />';
    await human();
    expect(transcript()).toContain("Run manually: az webapp deployment list-publishing-profiles");
    expect(transcript()).not.toContain("fictional-password");
  });

  it("accepts XML publishing profiles containing nested database elements", async () => {
    profileResponse.stdout = '<publishData><publishProfile profileName="fictional" userPWD="fictional-password"><databases /></publishProfile></publishData>';
    await human();
    expect(transcript()).toContain(profileResponse.stdout);
    expect(transcript()).not.toContain("Run manually");
  });

  it("shows manual fallbacks for thrown credential errors without printing their details", async () => {
    const implementation = az.getMockImplementation();
    if (!implementation) throw new Error("Missing Azure mock implementation.");
    az.mockImplementation((file, args = []) => {
      if (args[0] === "webapp" || args[0] === "staticwebapp") throw new Error("fictional-password");
      return implementation(file, args);
    });
    await human();
    expect(transcript()).toContain("Run manually: az staticwebapp secrets list");
    expect(transcript()).toContain("Run manually: az webapp deployment list-publishing-profiles");
    expect(transcript()).not.toContain("fictional-password");
  });

  it.each(["", "{}", "null", "invalid-json"])("shows manual output and credential commands when resource outputs are unavailable (%s)", async (stdout) => {
    outputResponse.stdout = stdout;
    await human();
    expect(transcript()).toContain("resource name missing");
    expect(transcript()).toContain('"<swa-name>"');
    expect(transcript()).toContain('"<functions-app-name>"');
    expect(queries()).toHaveLength(1);
    expect(transcript()).not.toContain(token);
    expect(transcript()).not.toContain(profile);
  });

  it.each(["deployment group create", "group update --name"])("does not query credentials after %s fails", async (command) => {
    failCommand = command;
    await expect(human()).rejects.toThrow("Command failed");
    expect(queries()).toEqual([]);
    expect(transcript()).not.toContain("Provision completed");
  });

  it("does not query credentials if ledger persistence fails after deployment and tag success", async () => {
    jest.spyOn(migrations, "replaceMigrationManifest").mockImplementation(() => { throw new Error("fictional ledger failure"); });
    await expect(human()).rejects.toThrow("fictional ledger failure");
    expect(queries()).toEqual([]);
  });

  it("does not query credentials on human cancellation", async () => {
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    jest.mocked(prompts).mockResolvedValue({ approved: false });
    try {
      await createProvisionCommand().parseAsync([
        "node", "provision", "-g", options.resourceGroup, "--subscription", subscription,
        "--location", options.location, "--swa-location", options.swaLocation,
      ]);
      expect(transcript()).toContain("Provision cancelled");
      expect(queries()).toEqual([]);
      expect(exists).toBe(false);
    } finally {
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
      else Reflect.deleteProperty(process.stdin, "isTTY");
      if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
      else Reflect.deleteProperty(process.stdout, "isTTY");
    }
  });

  it("restores setup output after a successful explicit reconcile", async () => {
    exists = true;
    const manifest = migrations.loadMigrationManifest(root);
    tags[migrations.getMigrationTagKey(manifest.projectId)] = migrations.encodeMigrationState({ schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum });
    await human(["--reconcile"]);
    expect(transcript()).toContain("Provision completed (reconcile)");
    expect(transcript()).toContain(token);
    assertNoSecretsOnDisk();
  });

  it("does not query credentials on no-op or adoption", async () => {
    exists = true;
    const manifest = migrations.loadMigrationManifest(root);
    tags[migrations.getMigrationTagKey(manifest.projectId)] = migrations.encodeMigrationState({ schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum });
    await human();
    expect(queries()).toEqual([]);
    tags = {};
    migrations.replaceMigrationManifest({ ...manifest, baseline: { ...manifest.baseline, legacy: true } }, root);
    await human(["--adopt-existing", "--baseline", "0", "--what-if"]);
    expect(queries()).toEqual([]);
  });

  it("reads baseline resource outputs after a successful migration rather than using container-only migration outputs", async () => {
    exists = true;
    const manifest = migrations.loadMigrationManifest(root);
    tags[migrations.getMigrationTagKey(manifest.projectId)] = migrations.encodeMigrationState({ schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum });
    createCustomMigration("fictional-addition", root);
    await human();
    expect(transcript()).toContain("Provision completed (migrate)");
    expect(transcript()).toContain(token);
    expect(queries()[0]).toEqual(expect.arrayContaining(["--name", "swallowkit-baseline"]));
    assertNoSecretsOnDisk();
  });

  it("keeps successful machine and MCP apply responses credential-free and performs no secret queries", async () => {
    const plan = await planProvisionOperation(options);
    const writes: string[] = [];
    jest.spyOn(process.stdout, "write").mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    await runMachineCli(["node", "swallowkit", "machine", "apply", "provision", "--plan", plan.planId, "--approve"]);
    const stdout = writes.join("");
    expect(JSON.parse(stdout).ok).toBe(true);
    const runner = jest.fn(async () => ({ stdout, stderr: "", exitCode: 0 }));
    const tool = buildSwallowKitToolDefinitions(runner).find((entry) => entry.name === "swallowkit_apply_provision");
    if (!tool) throw new Error("Missing apply provision MCP tool.");
    const response = await tool.handler({ planId: plan.planId, approve: true });
    expect(runner).toHaveBeenCalledWith(["apply", "provision", "--plan", plan.planId, "--approve"]);
    for (const content of [stdout, JSON.stringify(response)]) {
      expect(content).not.toContain(token);
      expect(content).not.toContain("fictional-password");
      expect(content).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
    }
    expect(queries()).toEqual([]);
    assertNoSecretsOnDisk();
  });
});
