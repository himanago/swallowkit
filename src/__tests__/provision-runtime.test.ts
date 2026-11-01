import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import * as azureCli from "../utils/azure-cli";
import { azureCliDiagnostic, redactAzureText } from "../utils/azure-diagnostics";
import {
  ApplyProvisionResult, applyProvisionOperation, executeProvisionPlan, inspectProvisionOperation, planProvisionOperation,
} from "../core/operations/provision-operations";
import * as migrations from "../core/project/migrations";
import { loadProvisionRun, saveProvisionRun } from "../core/project/state";
import { formatProvisionResult, formatProvisionError } from "../cli/commands/provision";
import { formatCliError, runCli } from "../cli";
import { runMachineCli } from "../machine";
import { buildSwallowKitToolDefinitions } from "../mcp";

const fixture = path.join(__dirname, "fixtures", "azure-cli.cjs");
const subscription = "11111111-1111-1111-1111-111111111111";
const invocation = { command: process.execPath, prefixArgs: [fixture], source: "isolated az fixture" };
const originalCwd = process.cwd();

describe("actual Azure CLI subprocess behavior (no Azure)", () => {
  it("reproduces the old timeout hiding behind warning-only stderr", () => {
    const result = azureCli.runAzCli(["process", "slow", "5000"], { invocation, timeout: 1000 });
    expect(result).toMatchObject({ status: null, errorCode: "ETIMEDOUT", failureKind: "timeout" });
    expect(result.stderr).toContain("WARNING:");
    expect(azureCliDiagnostic(result, "submit")).toMatchObject({ exitCode: null, elapsedMs: expect.any(Number), failureKind: "timeout" });
  });

  it("reproduces the old maxBuffer process termination", () => {
    const result = azureCli.runAzCli(["process", "flood"], { invocation, timeout: 2000, captureBytes: 4096 });
    expect(result).toMatchObject({ status: null, errorCode: "ENOBUFS", failureKind: "buffer", stdoutTruncated: true });
  });

  it("accepts warning-only stderr with exit zero and waits for a slow subprocess", async () => {
    const result = await azureCli.runAzCliAsync(["process", "slow", "250"], { invocation, timeout: 2000 });
    expect(result).toMatchObject({ status: 0, stderr: expect.stringContaining("WARNING:"), stdoutTruncated: false });
    expect(result.failureKind).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(250);
  });

  it("drains large stdout/stderr without killing the process and bounds both captures", async () => {
    const result = await azureCli.runAzCliAsync(["process", "flood"], { invocation, timeout: 3000, captureBytes: 4096 });
    expect(result).toMatchObject({ status: 0, stdoutTruncated: true, stderrTruncated: true });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(4096);
    expect(azureCliDiagnostic(result, "submit").outputTruncated).toBe(true);
  });

  it.each<[string, string, number]>([["nonzero", "exit", 7], ["communication", "communication", 1]])("distinguishes %s failures", async (mode, failureKind, status) => {
    expect(await azureCli.runAzCliAsync(["process", mode], { invocation, timeout: 2000 })).toMatchObject({ status, failureKind });
  });

  it("distinguishes timeout, cancellation, and spawn failure", async () => {
    const timeout = await azureCli.runAzCliAsync(["process", "slow", "2000"], { invocation, timeout: 180 });
    expect(timeout.failureKind).toBe("timeout");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    const cancelled = await azureCli.runAzCliAsync(["process", "slow", "2000"], { invocation, signal: controller.signal, timeout: 2000 });
    clearTimeout(timer);
    expect(cancelled.failureKind).toBe("cancelled");
    const missing = await azureCli.runAzCliAsync([], { invocation: { command: path.join(originalCwd, "does-not-exist.exe"), prefixArgs: [], source: "fixture" } });
    expect(missing).toMatchObject({ status: null, errorCode: "ENOENT", failureKind: "spawn" });
  });

  it("rejects unbounded timeout options", async () => {
    await expect(azureCli.runAzCliAsync([], { invocation, timeout: 0 })).rejects.toThrow(/finite positive/);
    await expect(azureCli.runAzCliAsync([], { invocation, timeout: Infinity })).rejects.toThrow(/finite positive/);
  });

  it("preserves the actual OS exit/signal distinction instead of guessing", async () => {
    const result = await azureCli.runAzCliAsync(["process", "terminate"], { invocation, timeout: 3000 });
    expect(result.status).not.toBe(0);
    if (process.platform === "win32") expect(result).toMatchObject({ signal: null, failureKind: "exit" });
    else expect(result).toMatchObject({ signal: "SIGTERM", failureKind: "signal" });
  });

  it("redacts keys, credentials, JWTs, URL tokens, connection strings and deployment outputs", () => {
    const secret = "fixture-secret-do-not-print";
    const text = `functionKey=${secret} token=${secret} password=${secret} Bearer ${secret} https://host/?code=${secret} AccountEndpoint=https://host/;AccountKey=${secret};`;
    expect(redactAzureText(text)).not.toContain(secret);
    const json = JSON.stringify({ properties: { outputs: { plainName: { value: secret } }, parameters: { plainName: { value: secret } } }, error: { message: `apiKey=${secret}` } });
    expect(redactAzureText(json)).not.toContain(secret);
    expect(redactAzureText('{"outputs":{"unknown":{"value":"sensitive')).toContain("omitted");
    const escaped = 'opaque"sensitive\\value';
    const payload = JSON.stringify({ error: { message: `Invalid value '${escaped}'` } });
    expect(JSON.parse(redactAzureText(payload, [escaped])).error.message).not.toContain(escaped);
    expect(redactAzureText(`${payload}\nWARNING: fixture`, [escaped])).not.toContain(JSON.stringify(escaped).slice(1, -1));
  });

  (process.platform === "win32" ? it : it.skip)("passes actual Windows batch-wrapper arguments without shell expansion", async () => {
    const args = ["C:\\fixture app\\main.bicep", "a&b", "x|y", "(value)", "x!y", "x^y", "C:\\trailing space\\"];
    const result = await azureCli.runAzCliAsync(["process", "echo", ...args], {
      invocation: {
        command: process.env.ComSpec ?? "cmd.exe", prefixArgs: [],
        batchScript: path.join(__dirname, "fixtures", "az wrapper.cmd"),
        env: { SWALLOWKIT_FIXTURE_NODE: process.execPath }, source: "batch fixture",
      },
      timeout: 3000,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });
});

interface FixtureState {
  subscription: string;
  resourceGroup: string;
  groupExists: boolean;
  groupCreates: number;
  deploymentCreates: number;
  tagAttempts: number;
  failTags: number;
  applyTagBeforeFailure?: boolean;
  tags: Record<string, string>;
  deployments: Record<string, { correlationId: string; templateHash: string }>;
  states: string[];
  calls: string[][];
  warning?: boolean;
  submitMode?: string;
  submitStderr?: string;
  submitDelay?: number;
  queryMode?: string;
  template: Record<string, unknown>;
  remoteTemplate?: Record<string, unknown>;
  parameters: Record<string, { value: unknown; type?: string }>;
  error?: unknown;
  operations?: unknown[];
  outputs?: Record<string, string>;
  outputQueryFails?: boolean;
}

describe("provision execution, diagnosis and recovery using an az subprocess fixture", () => {
  let project: string;
  let stateFile: string;
  const options = { resourceGroup: "rg-provision-fixture", location: "japaneast", swaLocation: "eastasia" };
  const read = (): FixtureState => JSON.parse(fs.readFileSync(stateFile, "utf-8")) as FixtureState;
  const update = (patch: Partial<FixtureState>) => {
    const temporary = `${stateFile}.update-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify({ ...read(), ...patch }));
    fs.renameSync(temporary, stateFile);
  };
  const ledger = () => fs.readFileSync(path.join(project, migrations.MIGRATION_MANIFEST_PATH), "utf-8");

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(originalCwd, ".tmp-provision-"));
    fs.mkdirSync(path.join(project, "infra"), { recursive: true });
    fs.writeFileSync(path.join(project, "infra", "main.bicep"), "targetScope = 'resourceGroup'\nparam projectName string\nparam location string\nparam swaLocation string\n");
    fs.writeFileSync(path.join(project, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "fixture-app" } } }));
    fs.writeFileSync(path.join(project, "swallowkit.config.js"), "module.exports = {};\n");
    migrations.saveMigrationManifest(migrations.createMigrationManifest(project, { projectId: "fixture-project" }), project);
    stateFile = path.join(project, "az-state.json");
    const state: FixtureState = {
      subscription, resourceGroup: options.resourceGroup, groupExists: false, groupCreates: 0,
      deploymentCreates: 0, tagAttempts: 0, failTags: 0, tags: {}, deployments: {}, states: ["Succeeded"], calls: [],
      template: { $schema: "fixture", parameters: { projectName: { type: "string" }, location: { type: "string" }, swaLocation: { type: "string" } }, resources: [] },
      parameters: { projectName: { value: "fixture-app" }, location: { value: "japaneast" }, swaLocation: { value: "eastasia" } },
    };
    fs.writeFileSync(stateFile, JSON.stringify(state));
    process.chdir(project);
    azureCli.setAzCliInvocationForTesting({ ...invocation, env: { SWALLOWKIT_AZ_FIXTURE_STATE: stateFile } });
  });
  afterEach(() => {
    process.chdir(originalCwd);
    azureCli.resetAzCliInvocationCache();
    jest.restoreAllMocks();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it("keeps approval mandatory, makes no Azure writes before approval, and pins the subscription", async () => {
    const plan = await planProvisionOperation(options);
    expect(plan.subscription).toBe(subscription);
    await expect(executeProvisionPlan(plan)).rejects.toMatchObject({ code: "approval-required", status: "requires-human" });
    expect(read().groupCreates).toBe(0);
    expect(read().deploymentCreates).toBe(0);
    expect(read().tagAttempts).toBe(0);
    expect(plan.commandSpecs.filter(command => command.kind === "deployment")[0].args).toContain("--no-wait");
  });

  it("gives each newly reviewed provision plan its own identity", async () => {
    const first = await planProvisionOperation(options);
    const second = await planProvisionOperation(options);
    expect(second.planId).not.toBe(first.planId);
    expect(second.fingerprints).toEqual(first.fingerprints);
  });

  it("accepts warning-only stderr/exit zero and completes only after Azure, tag and ledger succeed", async () => {
    update({ warning: true });
    const plan = await planProvisionOperation(options, { persist: false });
    const result = await executeProvisionPlan(plan, { approve: true });
    expect(result).toMatchObject({ status: "complete", outcome: "succeeded", runId: plan.planId });
    expect(result.warnings.join(" ")).toContain("bicep.use_binary_from_path");
    expect(result.deployment?.state).toBe("Succeeded");
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
    expect(result).not.toHaveProperty("deploymentOutputs");
    expect(loadProvisionRun<{ outcome: string }>(plan.planId)?.outcome).toBe("succeeded");
    expect(read().calls.some(args => args.includes("--debug") || args.includes("cancel") || args.includes("delete"))).toBe(false);
  });

  it("returns trackable Running and resumes the same deployment, without any second create", async () => {
    update({ states: ["Running"] });
    const plan = await planProvisionOperation(options);
    const before = ledger();
    const running = await executeProvisionPlan(plan, { approve: true, waitSeconds: 0 });
    expect(running).toMatchObject({ status: "in-progress", outcome: "in-progress", deployment: { state: "Running" } });
    expect(ledger()).toBe(before);
    expect(read().tagAttempts).toBe(0);
    expect(formatProvisionResult(running)).not.toContain("Provisioning completed");
    const status = await inspectProvisionOperation({ planId: running.runId });
    expect(status.status).toBe("in-progress");
    expect(read().deploymentCreates).toBe(1);
    const callsBeforeDeniedResume = read().calls.length;
    await expect(applyProvisionOperation({ planId: running.runId })).rejects.toMatchObject({ code: "approval-required" });
    expect(read().calls).toHaveLength(callsBeforeDeniedResume);
    await expect(planProvisionOperation(options)).rejects.toMatchObject({ code: "provision-run-pending" });
    update({ states: ["Succeeded"] });
    const resumed = await applyProvisionOperation({ planId: running.runId, approve: true });
    expect(resumed.status).toBe("complete");
    expect(read().deploymentCreates).toBe(1);
    expect(read().tagAttempts).toBe(1);
    expect((await applyProvisionOperation({ planId: running.runId, approve: true })).status).toBe("complete");
    expect(read().deploymentCreates).toBe(1);
  });

  it("polls a long-running Azure deployment to terminal state within a bounded wait", async () => {
    update({ states: ["Accepted", "Running", "Succeeded"] });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 5, pollIntervalMs: 10 });
    expect(result.status).toBe("complete");
    expect(read().deploymentCreates).toBe(1);
  });

  it.each(["communication", "nonzero", "slow"])("distinguishes local %s from Azure Running", async (submitMode) => {
    update({ submitMode, states: ["Running"] });
    const original = azureCli.runAzCliAsync;
    jest.spyOn(azureCli, "runAzCliAsync").mockImplementation((args, runOptions) => original(args, {
      ...runOptions, ...(args[0] === "deployment" && args[2] === "create" ? { timeout: 1000 } : {}),
    }));
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    expect(result).toMatchObject({ status: "in-progress", deployment: { state: "Running" } });
    const diagnostic = result.diagnostics.find(entry => entry.phase === "baseline-submit")!;
    expect(diagnostic.failureKind).toBe(submitMode === "slow" ? "timeout" : submitMode === "communication" ? "communication" : "exit");
    expect(diagnostic.elapsedMs).toBeGreaterThan(0);
    expect(formatProvisionResult(result)).toContain(`kind=${diagnostic.failureKind}`);
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
    await executeProvisionPlan(await planForRun(result.runId), { approve: true, waitSeconds: 0 });
    expect(read().deploymentCreates).toBe(1);
  });

  async function planForRun(runId: string) {
    return loadProvisionRun<{ plan: Awaited<ReturnType<typeof planProvisionOperation>> }>(runId)!.plan;
  }

  it.each(["communication", "not-found", "invalid"])("reports unknown for a %s state query instead of inventing an Azure failure", async (queryMode) => {
    const plan = await planProvisionOperation(options);
    update({ queryMode });
    // Pre-submit reads must succeed/not-found; fail only the post-submit state query.
    const original = azureCli.runAzCliAsync;
    jest.spyOn(azureCli, "runAzCliAsync").mockImplementation(async (args, runOptions) => {
      if (args[0] === "deployment" && args[2] === "show" && read().deploymentCreates === 0) {
        update({ queryMode: undefined });
        const result = await original(args, runOptions);
        update({ queryMode });
        return result;
      }
      return original(args, runOptions);
    });
    const result = await executeProvisionPlan(plan, { approve: true, waitSeconds: 0 });
    expect(result).toMatchObject({ status: "blocked", outcome: "unknown", deployment: { state: "unknown" } });
    expect(result.warnings.join(" ")).toContain("not proof that Azure failed");
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
  });

  it("shows terminal Azure and deployment-operation causes alongside a nonzero az exit, with secrets redacted", async () => {
    const secret = "fixture-secret-do-not-print";
    update({
      submitMode: "nonzero", states: ["Failed"], error: { code: "DeploymentFailed", message: `apiKey=${secret}`, details: [{ code: "ParentError", message: "Nested module failed" }] },
      operations: [{ error: { error: { code: "SkuNotAvailable", message: `Capacity unavailable; functionKey=${secret}` } } }],
    });
    const plan = await planProvisionOperation(options);
    let failure: unknown;
    try { await executeProvisionPlan(plan, { approve: true }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "azure-deployment-failed", status: "failed" });
    expect(formatCliError(failure)).toContain("SkuNotAvailable");
    expect(formatCliError(failure)).toContain("exit=7");
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(read().tagAttempts).toBe(0);
  });

  it("does not mark Canceled deployments as successful", async () => {
    update({ states: ["Canceled"], error: { code: "DeploymentCanceled", message: "Cancelled outside SwallowKit" } });
    await expect(executeProvisionPlan(await planProvisionOperation(options), { approve: true })).rejects.toMatchObject({ code: "azure-deployment-failed" });
    expect(read().tagAttempts).toBe(0);
  });

  it("uses proven Azure Succeeded even after a local nonzero exit, while preserving that local error diagnostic", async () => {
    update({ submitMode: "nonzero" });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    expect(result).toMatchObject({ status: "complete", outcome: "succeeded", deployment: { state: "Succeeded" } });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ phase: "baseline-submit", exitCode: 7, failureKind: "exit" })]));
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
  });

  it.each([false, true])("recovers a tag failure (tag already applied: %s) without redeploying Bicep", async (applyTagBeforeFailure) => {
    update({ failTags: 1, applyTagBeforeFailure });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    expect(result).toMatchObject({ status: "blocked", outcome: "partial", deployment: { state: "Succeeded" } });
    const before = read().tagAttempts;
    const status = await inspectProvisionOperation({ planId: result.runId });
    expect(status.outcome).toBe("partial");
    expect(read().tagAttempts).toBe(before);
    expect((await applyProvisionOperation({ planId: result.runId, approve: true })).status).toBe("complete");
    expect(read().deploymentCreates).toBe(1);
    expect(read().tagAttempts).toBe(applyTagBeforeFailure ? 1 : 2);
  });

  it("resumes local ledger failure after successful Azure/tag completion without any Azure create or tag replay", async () => {
    jest.spyOn(migrations, "replaceMigrationManifest").mockImplementationOnce(() => { throw new Error("fixture ledger write locked"); });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    expect(result.outcome).toBe("partial");
    expect(formatProvisionResult(result)).toContain("checkpoint");
    expect((await applyProvisionOperation({ planId: result.runId, approve: true })).status).toBe("complete");
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
  });

  it("handles Ctrl+C during az waiting without cancelling Azure or updating the ledger", async () => {
    update({ submitMode: "slow", states: ["Running"] });
    const original = azureCli.runAzCliAsync;
    jest.spyOn(azureCli, "runAzCliAsync").mockImplementation((args, runOptions) => {
      if (args[0] === "deployment" && args[2] === "create") {
        const deadline = Date.now() + 3000;
        const timer = setInterval(() => {
          if (read().deploymentCreates > 0 || Date.now() >= deadline) {
            clearInterval(timer);
            process.emit("SIGINT");
          }
        }, 20);
      }
      return original(args, runOptions);
    });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    expect(result.interrupted).toBe("SIGINT");
    expect(result.status).not.toBe("complete");
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
    expect(formatProvisionResult(result)).toContain("Azure may continue");
    update({ states: ["Succeeded"], submitMode: undefined });
    expect((await applyProvisionOperation({ planId: result.runId, approve: true })).status).toBe("complete");
    expect(read().deploymentCreates).toBe(1);
  });

  it("recovers after hard process termination from the pre-submit checkpoint without a second create", async () => {
      update({ submitMode: "slow", submitDelay: 1000, states: ["Running"] });
      const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "provision-runner.cjs")], {
        cwd: project, env: { ...process.env, SWALLOWKIT_AZ_FIXTURE_STATE: stateFile },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.resume();
      child.stderr.resume();
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      try {
        const deadline = Date.now() + 10000;
        while (read().deploymentCreates === 0 && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        expect(read().deploymentCreates).toBe(1);
        child.kill("SIGKILL");
        await closed;
        const file = fs.readdirSync(path.join(project, ".swallowkit", "state", "provision")).find(name => name.endsWith(".json"))!;
        const runId = file.slice(0, -5);
        expect(read().tagAttempts).toBe(0);
        update({ states: ["Succeeded"], submitMode: undefined });
        expect((await applyProvisionOperation({ planId: runId, approve: true })).status).toBe("complete");
        expect(read().deploymentCreates).toBe(1);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await closed;
      }
  }, 20000);

  it("does not let large output kill provisioning or expose deployment output secrets", async () => {
    update({ submitMode: "flood" });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    expect(result.status).toBe("complete");
    expect(result.diagnostics.some(entry => entry.outputTruncated)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-do-not-print");
    expect(formatProvisionResult(result)).toContain("output omitted/truncated");
  });

  it("preserves fingerprint checks on resume and detects replacement of the original deployment identity", async () => {
    update({ states: ["Running"] });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    const file = path.join(project, "infra", "main.bicep");
    const original = fs.readFileSync(file, "utf-8");
    fs.appendFileSync(file, "// modified after approval");
    await expect(applyProvisionOperation({ planId: result.runId, approve: true })).rejects.toMatchObject({ code: "stale-plan" });
    fs.writeFileSync(file, original);
    update({ states: ["Succeeded"], deployments: { "swallowkit-baseline": { correlationId: "replacement", templateHash: "fixture-template-hash" } } });
    const status = await inspectProvisionOperation({ planId: result.runId });
    expect(status).toMatchObject({ outcome: "unknown", deployment: { reason: "identity-changed" } });
    expect(read().tagAttempts).toBe(0);
  });

  it("does not silently discard corrupt checkpoints and start another bootstrap", async () => {
    update({ states: ["Running"] });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    fs.writeFileSync(path.join(project, ".swallowkit", "state", "provision", `${result.runId}.json`), "{corrupt");
    await expect(applyProvisionOperation({ planId: result.runId, approve: true })).rejects.toMatchObject({ code: "invalid-provision-checkpoint" });
    expect(read().deploymentCreates).toBe(1);
  });

  it("blocks semantic checkpoint corruption even when its outcome claims success", async () => {
    const plan = await planProvisionOperation(options);
    saveProvisionRun({
      schemaVersion: 1, runId: plan.planId, projectRoot: path.resolve(project), cursor: 0,
      plan: { planId: plan.planId }, outcome: "succeeded", warnings: [], diagnostics: [], executedCommands: [],
    });
    await expect(planProvisionOperation(options)).rejects.toMatchObject({ code: "invalid-provision-checkpoint" });
    expect(read().deploymentCreates).toBe(0);
  });

  it("still provides read-only state when local reviewed files are unavailable, without exposing unredactable causes", async () => {
    update({ states: ["Running"] });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    fs.unlinkSync(path.join(project, "infra", "main.bicep"));
    update({ states: ["Failed"], error: { code: "FixtureError", message: "opaque-unavailable-secret" } });
    const status = await inspectProvisionOperation({ planId: result.runId });
    expect(status.deployment?.state).toBe("Failed");
    expect(JSON.stringify(status)).not.toContain("opaque-unavailable-secret");
    expect(status.warnings.join(" ")).toContain("omitted");
    expect(read().tagAttempts).toBe(0);
  });

  it("redacts opaque secure parameter values from warning text and Azure causes, even without a key label", async () => {
    const secret = "opaque-secure-parameter-value";
    fs.appendFileSync(path.join(project, "infra", "main.bicep"), "@secure()\nparam opaqueInput string\n");
    fs.writeFileSync(path.join(project, "infra", "main.parameters.json"), JSON.stringify({
      parameters: { projectName: { value: "fixture-app" }, opaqueInput: { value: secret } },
    }));
    update({ submitStderr: `WARNING: rejected value '${secret}'`, states: ["Failed"], error: { code: "ValidationFailed", message: `Invalid value '${secret}'` } });
    let failure: unknown;
    try { await executeProvisionPlan(await planProvisionOperation(options), { approve: true }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "azure-deployment-failed" });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(formatCliError(failure)).not.toContain(secret);
  });

  it("omits unsafe status diagnostics when reviewed parameters were replaced with different valid JSON", async () => {
    const secret = "opaque-original-parameter-value";
    fs.appendFileSync(path.join(project, "infra", "main.bicep"), "@secure()\nparam opaqueInput string\n");
    fs.writeFileSync(path.join(project, "infra", "main.parameters.json"), JSON.stringify({ parameters: { opaqueInput: { value: secret } } }));
    update({ states: ["Running"] });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    fs.writeFileSync(path.join(project, "infra", "main.parameters.json"), JSON.stringify({ parameters: { opaqueInput: { value: "replacement" } } }));
    update({ states: ["Failed"], error: { code: "InvalidInput", message: secret } });
    const status = await inspectProvisionOperation({ planId: result.runId });
    expect(status.deployment?.state).toBe("Failed");
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(status.warnings.join(" ")).toContain("changed");
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
  });

  it("redacts reviewed secure values from resource-group query failures as well as deployment failures", async () => {
    const secret = "opaque-group-query-secret";
    fs.appendFileSync(path.join(project, "infra", "main.bicep"), "@secure()\nparam opaqueInput string\n");
    fs.writeFileSync(path.join(project, "infra", "main.parameters.json"), JSON.stringify({ parameters: { opaqueInput: { value: secret } } }));
    const plan = await planProvisionOperation(options);
    const original = azureCli.runAzCliAsync;
    jest.spyOn(azureCli, "runAzCliAsync").mockImplementation((args, runOptions) =>
      args[0] === "group" && args[1] === "show"
        ? Promise.resolve({ status: 1, stdout: "", stderr: `Invalid value '${secret}'`, signal: null, failureKind: "exit", elapsedMs: 1, stdoutTruncated: false, stderrTruncated: false })
        : original(args, runOptions));
    let failure: unknown;
    try { await executeProvisionPlan(plan, { approve: true }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "azure-state-query-failed" });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(read().deploymentCreates).toBe(0);
  });

  it("rejects remote migration-state changes before tag/ledger completion", async () => {
    update({ states: ["Running"] });
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    const manifest = migrations.loadMigrationManifest(project);
    update({ states: ["Succeeded"], tags: { [migrations.getMigrationTagKey(manifest.projectId)]: migrations.encodeMigrationState({ schemaVersion: 1, version: 1, checksum: "f".repeat(64) }) } });
    await expect(applyProvisionOperation({ planId: result.runId, approve: true })).rejects.toMatchObject({ code: "stale-azure-state", nextActions: expect.any(Array) });
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
  });

  it("does not reuse a completed run's cached success for a newly reviewed bootstrap", async () => {
    const first = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    update({ groupExists: false, tags: {}, deployments: {} });
    const secondPlan = await planProvisionOperation(options);
    expect(secondPlan.planId).not.toBe(first.runId);
    expect((await executeProvisionPlan(secondPlan, { approve: true })).status).toBe("complete");
    expect(read().deploymentCreates).toBe(2);
  });

  it("read-only status rechecks completed migration bookkeeping instead of trusting cached success", async () => {
    const result = await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    update({ tags: {} });
    const status = await inspectProvisionOperation({ planId: result.runId });
    expect(status).toMatchObject({ outcome: "partial", status: "blocked", deployment: { state: "Succeeded" } });
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
  });

  it("bounds a multi-migration run and resumes only the remaining reviewed migration", async () => {
    await executeProvisionPlan(await planProvisionOperation(options), { approve: true });
    const { createCustomMigration } = await import("../core/operations/migration-generator");
    createCustomMigration("first", project);
    createCustomMigration("second", project);
    const plan = await planProvisionOperation(options);
    const result = await executeProvisionPlan(plan, { approve: true, waitSeconds: 0 });
    expect(result.outcome).toBe("partial");
    expect(read().deploymentCreates).toBe(2);
    expect((await applyProvisionOperation({ planId: result.runId, approve: true })).status).toBe("complete");
    expect(read().deploymentCreates).toBe(3);
    expect(read().calls.filter(args => args[0] === "deployment" && args[2] === "create").map(args => args[args.indexOf("--name") + 1]))
      .toEqual(expect.arrayContaining(["swallowkit-baseline", ...plan.pendingMigrations.map(migration => `swallowkit-migration-${migration.version}-${migration.checksum.slice(0, 12)}`)]));
  }, 20000);

  it("recovers an older untracked Running deployment using matching ARM/parameter evidence and no create", async () => {
    update({ groupExists: true, states: ["Running"], deployments: { "swallowkit-baseline": { correlationId: "old-correlation", templateHash: "fixture-template-hash" } } });
    const plan = await planProvisionOperation({ ...options, resumeDeployment: "swallowkit-baseline" });
    expect(plan.mode).toBe("recover");
    expect(plan.commands.every(command => !command.includes(" create "))).toBe(true);
    expect((await executeProvisionPlan(plan, { approve: true, waitSeconds: 0 })).status).toBe("in-progress");
    update({ states: ["Succeeded"] });
    expect((await applyProvisionOperation({ planId: plan.planId, approve: true })).status).toBe("complete");
    expect(read()).toMatchObject({ groupCreates: 0, deploymentCreates: 0, tagAttempts: 1 });
  });

  it.each(["template", "parameters", "secure"])("blocks unsafe untracked-deployment recovery: %s evidence", async (kind) => {
    update({ groupExists: true, deployments: { "swallowkit-baseline": { correlationId: "old", templateHash: "fixture-template-hash" } } });
    if (kind === "template") update({ remoteTemplate: { resources: [{ type: "unexpected" }] } });
    if (kind === "parameters") update({ parameters: { ...read().parameters, location: { value: "westus2" } } });
    if (kind === "secure") update({ template: { ...read().template, parameters: { password: { type: "secureString" } } } });
    await expect(planProvisionOperation({ ...options, resumeDeployment: "swallowkit-baseline" })).rejects.toMatchObject({
      code: kind === "template" ? "recovery-template-mismatch" : kind === "parameters" ? "recovery-parameters-mismatch" : "recovery-secure-parameters",
    });
    expect(read()).toMatchObject({ deploymentCreates: 0, tagAttempts: 0 });
  });

  it("keeps regular CLI, machine, MCP status and nextActions consistent", async () => {
    update({ states: ["Running"] });
    const logs: string[] = [];
    jest.spyOn(console, "log").mockImplementation((text: unknown) => { logs.push(String(text)); });
    await runCli(["node", "swallowkit", "provision", "-g", options.resourceGroup, "--location", options.location, "--swa-location", options.swaLocation, "--approve", "--wait-seconds", "0"]);
    expect(logs.join("\n")).toContain("still in progress");
    expect(logs.join("\n")).not.toContain("Provisioning completed");
    const file = fs.readdirSync(path.join(project, ".swallowkit", "state", "provision")).find(name => name.endsWith(".json"))!;
    const runId = file.slice(0, -5);
    const writes: string[] = [];
    jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; });
    const previousExitCode = process.exitCode;
    await runMachineCli(["node", "swallowkit", "machine", "inspect", "provision", "--plan", runId]);
    process.exitCode = previousExitCode;
    const machine = JSON.parse(writes.join("")) as { ok: boolean; status: string; data: ApplyProvisionResult; nextActions: unknown[] };
    expect(machine.status).toBe("in-progress");
    expect(machine.nextActions).toEqual(machine.data.nextActions);
    const runner = jest.fn(async () => ({ stdout: JSON.stringify(machine), stderr: "", exitCode: 0 }));
    const tool = buildSwallowKitToolDefinitions(runner).find(candidate => candidate.name === "swallowkit_inspect_provision")!;
    const mcp = JSON.parse((await tool.handler({ planId: runId, waitSeconds: 0 })).content[0].text);
    expect(mcp).toMatchObject({ status: "in-progress", runId, nextActions: machine.nextActions, metadata: { swallowkitVersion: expect.any(String) } });
    expect(runner).toHaveBeenCalledWith(["inspect", "provision", "--plan", runId, "--wait-seconds", "0"]);
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
  });

  it("treats normal provision invocation as consent without an extra prompt or machine instructions", async () => {
    update({ outputs: { functionsAppName: "func-fixture", staticWebAppName: "swa-fixture", apiKey: "secret-not-for-terminal" } });
    const logs: string[] = [];
    jest.spyOn(console, "log").mockImplementation((text: unknown) => { logs.push(String(text)); });
    await runCli(["node", "swallowkit", "provision", "-g", options.resourceGroup, "--location", options.location, "--swa-location", options.swaLocation]);
    const output = logs.join("\n");
    expect(output).toContain("Provisioning completed");
    expect(output).toContain("AZURE_FUNCTIONAPP_NAME: func-fixture");
    expect(output).toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
    expect(output).not.toContain("secret-not-for-terminal");
    expect(output).not.toMatch(/machine |--approve|Run these Azure commands|Plan /);
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
    expect(read().calls.some(args => args[0] === "staticwebapp" && args[1] === "secrets")).toBe(false);
  });

  it("keeps normal CLI terminal failure instructions human-only and does not suggest resuming as a repair", async () => {
    update({ states: ["Failed"], error: { code: "NotFound", message: "Request url is invalid." } });
    let failure: unknown;
    try {
      await runCli(["node", "swallowkit", "provision", "-g", options.resourceGroup, "--location", options.location, "--swa-location", options.swaLocation]);
    } catch (error) { failure = error; }
    const output = formatCliError(failure);
    expect(output).toContain("NotFound: Request url is invalid.");
    expect(output).toContain("swallowkit provision --status");
    expect(output).not.toMatch(/machine |--plan|--approve|Resume:/);
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 0 });
  });

  it("shows human commands when existing execution state blocks a new provision", async () => {
    update({ states: ["Running"] });
    const running = await executeProvisionPlan(await planProvisionOperation(options), { approve: true, waitSeconds: 0 });
    let failure: unknown;
    try { await planProvisionOperation(options); } catch (error) { failure = error; }
    const output = formatProvisionError(failure);
    expect(output).toContain(`swallowkit provision --status ${running.runId}`);
    expect(output).not.toMatch(/machine |--plan|--approve/);
    expect(read().deploymentCreates).toBe(1);
  });

  it("does not redeploy or report deployment failure when resource outputs cannot be read after success", async () => {
    update({ outputQueryFails: true });
    const warnings: string[] = [];
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation((text: unknown) => { warnings.push(String(text)); });
    await runCli(["node", "swallowkit", "provision", "-g", options.resourceGroup, "--location", options.location, "--swa-location", options.swaLocation]);
    expect(warnings.join("\n")).toContain("Deployment succeeded, but resource information could not be read");
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
  });

  it("resumes a human-invoked run without an additional approval and never resubmits Bicep", async () => {
    update({ states: ["Running"] });
    jest.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["node", "swallowkit", "provision", "-g", options.resourceGroup, "--location", options.location, "--swa-location", options.swaLocation, "--wait-seconds", "0"]);
    const file = fs.readdirSync(path.join(project, ".swallowkit", "state", "provision")).find(name => name.endsWith(".json"))!;
    const runId = file.slice(0, -5);
    update({ states: ["Succeeded"] });
    await runCli(["node", "swallowkit", "provision", "--resume", runId]);
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
    expect(loadProvisionRun<{ outcome: string }>(runId)?.outcome).toBe("succeeded");
  });

  it("retains successful deployment when the output-reading helper throws", async () => {
    const original = azureCli.runAzCliAsync;
    jest.spyOn(azureCli, "runAzCliAsync").mockImplementation((args, runOptions) =>
      args.some(arg => arg.includes("properties.outputs.")) ? Promise.reject(new Error("Fixture output transport failed")) : original(args, runOptions));
    jest.spyOn(console, "log").mockImplementation(() => {});
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    await runCli(["node", "swallowkit", "provision", "-g", options.resourceGroup, "--location", options.location, "--swa-location", options.swaLocation]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Deployment succeeded, but resource information could not be read"));
    expect(read()).toMatchObject({ deploymentCreates: 1, tagAttempts: 1 });
  });
});
