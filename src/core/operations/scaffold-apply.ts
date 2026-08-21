/**
 * Apply Scaffold — Plan の検証(stale 検出・承認チェック)を経て scaffold を実際に適用する。
 */

import { MachineCommandError } from "../../machine/errors";
import { deletePlanState, loadPlanState } from "../project/state";
import { runMachineScaffoldOperation, MachineScaffoldOperationResult } from "./scaffold-machine";
import {
  planScaffoldOperation,
  ScaffoldPlanData,
  ScaffoldPlanOperation,
  verifyPlanFingerprints,
} from "./scaffold-plan";

export interface ApplyScaffoldOptions {
  model?: string;
  planId?: string;
  approve?: boolean;
  functionsDir?: string;
  apiDir?: string;
  apiOnly?: boolean;
}

export interface ApplyScaffoldResult extends MachineScaffoldOperationResult {
  model: string;
  planId: string;
  approvedConflicts: ScaffoldPlanOperation[];
  warnings: string[];
}

export async function applyScaffoldOperation(options: ApplyScaffoldOptions): Promise<ApplyScaffoldResult> {
  const projectRoot = process.cwd();

  let basePlan: ScaffoldPlanData | null = null;

  if (options.planId) {
    basePlan = loadPlanState<ScaffoldPlanData>(options.planId, projectRoot);
    if (!basePlan) {
      throw new MachineCommandError(
        "plan-not-found",
        `Plan "${options.planId}" was not found. Run "plan scaffold" to create a new plan.`,
        { planId: options.planId },
        "blocked"
      );
    }

    const freshness = verifyPlanFingerprints(basePlan, projectRoot);
    if (!freshness.fresh) {
      throw new MachineCommandError(
        "stale-plan",
        `Plan "${options.planId}" is stale: ${freshness.changedFiles.length} file(s) changed after the plan was created. Re-run "plan scaffold".`,
        { planId: options.planId, changedFiles: freshness.changedFiles },
        "blocked"
      );
    }
  }

  const model = options.model ?? basePlan?.model;
  if (!model) {
    throw new MachineCommandError(
      "invalid-arguments",
      "Either a model name or --plan <planId> must be provided.",
      undefined,
      "failed"
    );
  }

  const effectiveOptions = {
    model,
    functionsDir: options.functionsDir ?? basePlan?.options.functionsDir,
    apiDir: options.apiDir ?? basePlan?.options.apiDir,
    apiOnly: options.apiOnly ?? basePlan?.options.apiOnly,
  };

  // 常に最新状態で collect し、競合を検出する(plan 指定時も現況を再確認)
  const currentPlan = await planScaffoldOperation(effectiveOptions);

  if (currentPlan.requiresApproval && !options.approve) {
    // 承認待ちの plan は残し、参照できるようにする
    throw new MachineCommandError(
      "approval-required",
      `${currentPlan.conflicts.length} file(s) were modified after generation and would be overwritten. Review the conflicts and re-run with --approve to proceed.`,
      {
        planId: currentPlan.planId,
        conflicts: currentPlan.conflicts,
      },
      "requires-human"
    );
  }

  const result = await runMachineScaffoldOperation(effectiveOptions);

  // 適用済み plan の状態を破棄
  deletePlanState(currentPlan.planId, projectRoot);
  if (options.planId && options.planId !== currentPlan.planId) {
    deletePlanState(options.planId, projectRoot);
  }

  return {
    ...result,
    model,
    planId: currentPlan.planId,
    approvedConflicts: options.approve ? currentPlan.conflicts : [],
    warnings: currentPlan.warnings,
  };
}
