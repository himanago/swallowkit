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
