/**
 * ローカル状態管理 — `.swallowkit/state/`
 *
 * Pending plan と最新の Verify 結果を保存する。Git 管理対象外
 * (ディレクトリ内に自己 ignore する .gitignore を生成する)。
 */

import * as fs from "fs";
import * as path from "path";

export const SWALLOWKIT_STATE_DIR = path.join(".swallowkit", "state");

function ensureStateDir(projectRoot: string): string {
  const stateDir = path.join(projectRoot, SWALLOWKIT_STATE_DIR);
  fs.mkdirSync(path.join(stateDir, "plans"), { recursive: true });

  const gitignorePath = path.join(stateDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf-8");
  }

  return stateDir;
}

function planPath(projectRoot: string, planId: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(planId)) {
    throw new Error(`Invalid plan id: ${planId}`);
  }
  return path.join(projectRoot, SWALLOWKIT_STATE_DIR, "plans", `${planId}.json`);
}

export function savePlanState<TPlan extends { planId: string }>(
  plan: TPlan,
  projectRoot: string = process.cwd()
): void {
  ensureStateDir(projectRoot);
  fs.writeFileSync(planPath(projectRoot, plan.planId), JSON.stringify(plan, null, 2) + "\n", "utf-8");
}

export function loadPlanState<TPlan>(planId: string, projectRoot: string = process.cwd()): TPlan | null {
  const filePath = planPath(projectRoot, planId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TPlan;
  } catch {
    // 破損した plan は「存在しない」扱いに退化させ、呼び出し側の plan-not-found で再計画を促す
    return null;
  }
}

export function deletePlanState(planId: string, projectRoot: string = process.cwd()): void {
  const filePath = planPath(projectRoot, planId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function provisionRunPath(runId: string, projectRoot: string): string {
  if (!/^[a-f0-9]{12}$/.test(runId)) throw new Error("Invalid provision run ID.");
  return path.join(projectRoot, SWALLOWKIT_STATE_DIR, "provision", `${runId}.json`);
}

export function saveProvisionRun<T extends { runId: string }>(run: T, projectRoot: string = process.cwd()): void {
  ensureStateDir(projectRoot);
  const file = provisionRunPath(run.runId, projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function loadProvisionRun<T>(runId: string, projectRoot: string = process.cwd()): T | null {
  const file = provisionRunPath(runId, projectRoot);
  if (!fs.existsSync(file)) return null;
  // Unlike a preview, discarding a corrupt execution checkpoint could replay Azure writes.
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

export function listProvisionRuns<T>(projectRoot: string = process.cwd()): T[] {
  const directory = path.join(projectRoot, SWALLOWKIT_STATE_DIR, "provision");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => /^[a-f0-9]{12}\.json$/.test(name))
    .map((name) => loadProvisionRun<T>(name.slice(0, -5), projectRoot)!);
}

/** A live local executor must not share an Azure target with another executor. */
export function lockProvisionTarget(key: string, projectRoot: string = process.cwd()): () => void {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid provision lock key.");
  const directory = path.join(ensureStateDir(projectRoot), "provision");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${key}.lock`);
  const create = () => {
    const descriptor = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(descriptor, String(process.pid)); } finally { fs.closeSync(descriptor); }
  };
  try {
    create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const recoveryFile = `${file}.recovery`;
    let descriptor: number;
    try {
      descriptor = fs.openSync(recoveryFile, "wx", 0o600);
    } catch (recoveryError) {
      if ((recoveryError as NodeJS.ErrnoException).code !== "EEXIST") throw recoveryError;
      throw new Error("Provision lock recovery is already in progress. Inspect the checkpoint before retrying.");
    }
    fs.closeSync(descriptor);
    try {
      const pid = Number(fs.readFileSync(file, "utf-8"));
      if (!Number.isInteger(pid) || pid < 1) throw new Error("Invalid provision lock; inspect the checkpoint before removing the lock.");
      try {
        process.kill(pid, 0);
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
        fs.unlinkSync(file);
        create();
        return () => fs.unlinkSync(file);
      }
      throw new Error("Another local provision executor is using this Azure target. Inspect its run; do not start a second deployment.");
    } finally {
      fs.unlinkSync(recoveryFile);
    }
  }
  return () => fs.unlinkSync(file);
}

const LAST_VERIFY_FILE = "last-verify.json";

export function saveLastVerifyState(result: unknown, projectRoot: string = process.cwd()): void {
  const stateDir = ensureStateDir(projectRoot);
  fs.writeFileSync(path.join(stateDir, LAST_VERIFY_FILE), JSON.stringify(result, null, 2) + "\n", "utf-8");
}

export function loadLastVerifyState<TResult>(projectRoot: string = process.cwd()): TResult | null {
  const filePath = path.join(projectRoot, SWALLOWKIT_STATE_DIR, LAST_VERIFY_FILE);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TResult;
  } catch {
    return null;
  }
}
