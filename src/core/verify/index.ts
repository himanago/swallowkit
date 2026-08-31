/**
 * Verify — 生成後の検証チェックを実行し、機械可読な結果を返す。
 *
 * 提供チェック:
 * - structure:  プロジェクト構造規約 (validateProject)
 * - drift:      生成物と現在状態の乖離 (detectDrift)
 * - typecheck:  TypeScript 型チェック (tsc --noEmit / typecheck script)
 * - build/lint/test: package.json scripts に同名 script がある場合のみ実行 (なければ skip)
 * - custom:     swallowkit.config の verify.checks で定義されたプロジェクト固有チェック
 *
 * 既定実行セットは structure/drift/typecheck + custom。build/lint/test は --checks で明示指定。
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { loadConfig } from "../config";
import { detectDrift, DriftFinding } from "../project/drift";
import { saveLastVerifyState } from "../project/state";
import { ProjectViolation, validateProject } from "../project/validation";
import { CustomVerifyCheck } from "../../types";
import { detectFromProject, getCommands } from "../../utils/package-manager";

export type VerifyCheckStatus = "pass" | "fail" | "skip" | "error";

export interface VerifyCheckEvidence {
  command?: string;
  exitCode?: number;
  violations?: ProjectViolation[];
  findings?: DriftFinding[];
  logTail?: string[];
  /** --compact で抑制された info-severity findings の件数。 */
  suppressedInfoFindings?: number;
}

export interface VerifyCheckResult {
  id: string;
  title: string;
  status: VerifyCheckStatus;
  durationMs: number;
  fixable: boolean;
  evidence: VerifyCheckEvidence;
  suggestedActions: string[];
}

export interface VerifySummary {
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  /** true = すべてのチェックが pass または skip */
  done: boolean;
}

export interface VerifyResult {
  checks: VerifyCheckResult[];
  summary: VerifySummary;
  verifiedAt: string;
}

export const AVAILABLE_VERIFY_CHECKS = ["structure", "drift", "typecheck", "build", "lint", "test"] as const;
export type VerifyCheckId = (typeof AVAILABLE_VERIFY_CHECKS)[number];

/** 既定で実行される built-in チェック。build/lint/test は明示指定時のみ。 */
export const DEFAULT_VERIFY_CHECKS = ["structure", "drift", "typecheck"] as const;

async function runStructureCheck(projectRoot: string): Promise<VerifyCheckResult> {
  const startedAt = Date.now();
  try {
    const result = await validateProject(projectRoot);
    const errors = result.violations.filter((violation) => violation.severity === "error");
    return {
      id: "structure",
      title: "Project structure conventions",
      status: errors.length === 0 ? "pass" : "fail",
      durationMs: Date.now() - startedAt,
      fixable: true,
      evidence: { violations: result.violations },
      suggestedActions:
        errors.length === 0
          ? []
          : errors.map((violation) => violation.suggestedFix ?? violation.message),
    };
  } catch (error) {
    return {
      id: "structure",
      title: "Project structure conventions",
      status: "error",
      durationMs: Date.now() - startedAt,
      fixable: false,
      evidence: { logTail: [error instanceof Error ? error.message : String(error)] },
      suggestedActions: ["Run this command inside a SwallowKit project root."],
    };
  }
}

async function runDriftCheck(projectRoot: string): Promise<VerifyCheckResult> {
  const startedAt = Date.now();
  try {
    const result = await detectDrift(projectRoot);
    const errors = result.findings.filter((finding) => finding.severity === "error");
    return {
      id: "drift",
      title: "Generated artifact drift",
      status: errors.length === 0 ? "pass" : "fail",
      durationMs: Date.now() - startedAt,
      fixable: true,
      evidence: { findings: result.findings },
      suggestedActions: errors.map((finding) => finding.repairAction),
    };
  } catch (error) {
    return {
      id: "drift",
      title: "Generated artifact drift",
      status: "error",
      durationMs: Date.now() - startedAt,
      fixable: false,
      evidence: { logTail: [error instanceof Error ? error.message : String(error)] },
      suggestedActions: [],
    };
  }
}

function tailLines(text: string, count: number): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-count);
}

interface CommandCheckSpec {
  id: string;
  title: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  failAction: string;
}

function runCommandCheck(projectRoot: string, spec: CommandCheckSpec): VerifyCheckResult {
  const startedAt = Date.now();
  const commandLabel = [spec.command, ...spec.args].join(" ").trim();
  try {
    const result = spawnSync(spec.command, spec.args, {
      cwd: projectRoot,
      shell: true,
      encoding: "utf-8",
      timeout: spec.timeoutMs ?? 5 * 60 * 1000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const exitCode = typeof result.status === "number" ? result.status : -1;

    if (result.error) {
      return {
        id: spec.id,
        title: spec.title,
        status: "error",
        durationMs: Date.now() - startedAt,
        fixable: false,
        evidence: { command: commandLabel, logTail: [result.error.message] },
        suggestedActions: [`Ensure "${commandLabel}" can run in this project.`],
      };
    }

    return {
      id: spec.id,
      title: spec.title,
      status: exitCode === 0 ? "pass" : "fail",
      durationMs: Date.now() - startedAt,
      fixable: true,
      evidence: {
        command: commandLabel,
        exitCode,
        logTail: tailLines(output, 50),
      },
      suggestedActions: exitCode === 0 ? [] : [spec.failAction],
    };
  } catch (error) {
    return {
      id: spec.id,
      title: spec.title,
      status: "error",
      durationMs: Date.now() - startedAt,
      fixable: false,
      evidence: { command: commandLabel, logTail: [error instanceof Error ? error.message : String(error)] },
      suggestedActions: [],
    };
  }
}

function readPackageScripts(projectRoot: string): Record<string, string> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function runTypecheckCheck(projectRoot: string): VerifyCheckResult {
  const startedAt = Date.now();

  if (!fs.existsSync(path.join(projectRoot, "tsconfig.json"))) {
    return {
      id: "typecheck",
      title: "TypeScript type check",
      status: "skip",
      durationMs: Date.now() - startedAt,
      fixable: false,
      evidence: { logTail: ["tsconfig.json not found; skipping typecheck."] },
      suggestedActions: [],
    };
  }

  // typecheck は shared のビルド済み dist/ を参照する。古い dist による
  // 「no exported member」誤検知を防ぐため、先に shared をビルドする。
  const sharedBuild = runSharedBuildIfPresent(projectRoot);
  if (sharedBuild.ran && !sharedBuild.ok) {
    return {
      id: "typecheck",
      title: "TypeScript type check",
      status: "fail",
      durationMs: Date.now() - startedAt,
      fixable: true,
      evidence: { command: sharedBuild.command, logTail: sharedBuild.logTail },
      suggestedActions: [
        "Fix the shared package build errors first; typecheck resolves the shared package from its built dist/.",
      ],
    };
  }

  const scripts = readPackageScripts(projectRoot);
  let command: string;
  let args: string[];
  if (typeof scripts.typecheck === "string") {
    const pm = detectFromProject(projectRoot);
    command = getCommands(pm).name;
    args = ["run", "typecheck"];
  } else {
    command = "npx";
    args = ["tsc", "--noEmit"];
  }

  return runCommandCheck(projectRoot, {
    id: "typecheck",
    title: "TypeScript type check",
    command,
    args,
    failAction: "Fix the TypeScript errors listed in evidence.logTail, then re-run verify.",
  });
}

const SCRIPT_CHECK_TITLES: Record<string, string> = {
  build: "Project build",
  lint: "Lint",
  test: "Test suite",
};

interface SharedBuildOutcome {
  ran: boolean;
  ok: boolean;
  command?: string;
  logTail?: string[];
}

/** shared/package.json に build script があれば実行する (なければ no-op)。 */
function runSharedBuildIfPresent(projectRoot: string): SharedBuildOutcome {
  const sharedPackageJsonPath = path.join(projectRoot, "shared", "package.json");
  if (!fs.existsSync(sharedPackageJsonPath)) return { ran: false, ok: true };
  try {
    const pkg = JSON.parse(fs.readFileSync(sharedPackageJsonPath, "utf-8")) as { scripts?: Record<string, string> };
    if (typeof pkg.scripts?.build !== "string") return { ran: false, ok: true };
  } catch {
    return { ran: false, ok: true };
  }

  const pm = detectFromProject(projectRoot);
  const command = getCommands(pm).name;
  const result = spawnSync(command, ["run", "build"], {
    cwd: path.join(projectRoot, "shared"),
    shell: true,
    encoding: "utf-8",
    timeout: 5 * 60 * 1000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const ok = result.status === 0 && !result.error;
  return {
    ran: true,
    ok,
    command: `${command} run build (in shared/)`,
    logTail: ok ? undefined : tailLines(result.error ? `${output}\n${result.error.message}` : output, 50),
  };
}

function runScriptCheck(projectRoot: string, scriptName: "build" | "lint" | "test"): VerifyCheckResult {
  const startedAt = Date.now();
  const scripts = readPackageScripts(projectRoot);
  const title = SCRIPT_CHECK_TITLES[scriptName];

  if (typeof scripts[scriptName] !== "string") {
    return {
      id: scriptName,
      title,
      status: "skip",
      durationMs: Date.now() - startedAt,
      fixable: false,
      evidence: { logTail: [`No "${scriptName}" script in package.json; skipping.`] },
      suggestedActions: [],
    };
  }

  const pm = detectFromProject(projectRoot);
  return runCommandCheck(projectRoot, {
    id: scriptName,
    title,
    command: getCommands(pm).name,
    args: ["run", scriptName],
    timeoutMs: 10 * 60 * 1000,
    failAction: `Fix the ${scriptName} failures listed in evidence.logTail, then re-run verify.`,
  });
}

const CUSTOM_CHECK_ID = /^[a-z][a-z0-9-]*$/;

/** swallowkit.config の verify.checks を projectRoot 基準で静かに読み込む。 */
export function loadCustomVerifyChecks(projectRoot: string): CustomVerifyCheck[] {
  const configNames = ["swallowkit.config.json", "swallowkit.config.js", ".swallowkitrc.json"];
  for (const name of configNames) {
    const configPath = path.join(projectRoot, name);
    if (!fs.existsSync(configPath)) continue;
    try {
      const checks = loadConfig(configPath, false, true).verify?.checks ?? [];
      return checks.filter(
        (check) =>
          typeof check?.id === "string" &&
          CUSTOM_CHECK_ID.test(check.id) &&
          !(AVAILABLE_VERIFY_CHECKS as readonly string[]).includes(check.id) &&
          typeof check.command === "string" &&
          check.command.trim().length > 0
      );
    } catch {
      return [];
    }
  }
  return [];
}

function runCustomCheck(projectRoot: string, check: CustomVerifyCheck): VerifyCheckResult {
  return runCommandCheck(projectRoot, {
    id: check.id,
    title: check.title ?? `Custom check: ${check.id}`,
    command: check.command,
    args: [],
    timeoutMs: check.timeoutMs,
    failAction: `Fix the failures reported by "${check.command}", then re-run verify.`,
  });
}

export async function runVerify(
  checkIds?: string[],
  projectRoot: string = process.cwd()
): Promise<VerifyResult> {
  const customChecks = loadCustomVerifyChecks(projectRoot);
  const customIds = customChecks.map((check) => check.id);
  const availableIds = [...AVAILABLE_VERIFY_CHECKS, ...customIds];

  const requested = (checkIds && checkIds.length > 0
    ? checkIds
    : [...DEFAULT_VERIFY_CHECKS, ...customIds]
  ).map((id) => id.trim()).filter(Boolean);

  const unknown = requested.filter((id) => !availableIds.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown verify check(s): ${unknown.join(", ")}. Available checks: ${availableIds.join(", ")}`
    );
  }

  const checks: VerifyCheckResult[] = [];
  for (const id of requested) {
    if (id === "structure") {
      checks.push(await runStructureCheck(projectRoot));
    } else if (id === "drift") {
      checks.push(await runDriftCheck(projectRoot));
    } else if (id === "typecheck") {
      checks.push(runTypecheckCheck(projectRoot));
    } else if (id === "build" || id === "lint" || id === "test") {
      checks.push(runScriptCheck(projectRoot, id));
    } else {
      const custom = customChecks.find((check) => check.id === id);
      if (custom) checks.push(runCustomCheck(projectRoot, custom));
    }
  }

  const summary: VerifySummary = {
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    skipped: checks.filter((check) => check.status === "skip").length,
    errors: checks.filter((check) => check.status === "error").length,
    done: checks.every((check) => check.status === "pass" || check.status === "skip"),
  };

  const result: VerifyResult = {
    checks,
    summary,
    verifiedAt: new Date().toISOString(),
  };

  saveLastVerifyState(result, projectRoot);
  return result;
}

/**
 * Agent 消費向けに info-severity の drift findings (「user-owned が編集されたが想定内」等)
 * を除去したコンパクトな結果を返す。判定 (summary) は変わらない。
 */
export function compactVerifyResult(result: VerifyResult): VerifyResult {
  return {
    ...result,
    checks: result.checks.map((check) => {
      const findings = check.evidence.findings;
      if (!findings || findings.length === 0) return check;
      const kept = findings.filter((finding) => finding.severity !== "info");
      const suppressed = findings.length - kept.length;
      if (suppressed === 0) return check;
      return {
        ...check,
        evidence: { ...check.evidence, findings: kept, suppressedInfoFindings: suppressed },
      };
    }),
  };
}

export interface FailureExplanation {
  checkId: string;
  title: string;
  status: VerifyCheckStatus;
  verifiedAt: string;
  evidence: VerifyCheckEvidence;
  suggestedActions: string[];
}

export function explainVerifyFailure(
  lastVerify: VerifyResult,
  checkId?: string
): FailureExplanation[] {
  const targets = checkId
    ? lastVerify.checks.filter((check) => check.id === checkId)
    : lastVerify.checks.filter((check) => check.status === "fail" || check.status === "error");

  if (checkId && targets.length === 0) {
    throw new Error(
      `Unknown check "${checkId}" in the last verify result. Available: ${lastVerify.checks.map((check) => check.id).join(", ")}`
    );
  }

  return targets.map((check) => ({
    checkId: check.id,
    title: check.title,
    status: check.status,
    verifiedAt: lastVerify.verifiedAt,
    evidence: check.evidence,
    suggestedActions: check.suggestedActions,
  }));
}
