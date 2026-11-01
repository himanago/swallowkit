import { runAzCliAsync } from "../../utils/azure-cli";
import { AzureCliDiagnostic, azureCliDiagnostic, redactAzureText } from "../../utils/azure-diagnostics";

export const DEPLOYMENT_QUERY = "{id:id,name:name,state:properties.provisioningState,correlationId:properties.correlationId,templateHash:properties.templateHash,timestamp:properties.timestamp,error:properties.error}";
export const DEFAULT_PROVISION_WAIT_SECONDS = 300;
export const MAX_PROVISION_WAIT_SECONDS = 3_600;

export interface DeploymentReference {
  subscription: string;
  resourceGroup: string;
  name: string;
  id?: string;
  correlationId?: string;
  templateHash?: string;
  /** Do not mistake a previous deployment under the same name for this submission. */
  previousCorrelationId?: string;
}

export interface AzureDeploymentError {
  code: string;
  message: string;
}

export interface DeploymentObservation {
  state: "Accepted" | "Running" | "Succeeded" | "Failed" | "Canceled" | "unknown";
  reference: DeploymentReference;
  reason?: "not-found" | "query-failed" | "invalid-response" | "identity-changed" | "not-yet-observed" | "cancelled";
  errors: AzureDeploymentError[];
  diagnostic: AzureCliDiagnostic;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function extractAzureErrors(value: unknown, secretValues: readonly string[] = []): AzureDeploymentError[] {
  const result: AzureDeploymentError[] = [];
  const visit = (entry: unknown, depth: number) => {
    if (depth > 8 || result.length >= 20) return;
    if (typeof entry === "string") {
      try { visit(JSON.parse(entry), depth + 1); } catch { /* Only structured Azure errors are projected. */ }
      return;
    }
    const item = record(entry);
    if (!item) return;
    if (typeof item.code === "string" && typeof item.message === "string") {
      result.push({ code: redactAzureText(item.code, secretValues).slice(0, 200), message: redactAzureText(item.message, secretValues).slice(0, 2_000) });
    }
    if (item.error) visit(item.error, depth + 1);
    if (Array.isArray(item.details)) item.details.forEach((detail) => visit(detail, depth + 1));
  };
  visit(value, 0);
  return result;
}

export function deploymentId(reference: DeploymentReference): string {
  return reference.id ?? `/subscriptions/${reference.subscription}/resourceGroups/${reference.resourceGroup}/providers/Microsoft.Resources/deployments/${reference.name}`;
}

export async function queryAzureDeployment(
  reference: DeploymentReference,
  options: { timeoutMs?: number; signal?: AbortSignal; secretValues?: readonly string[] } = {}
): Promise<DeploymentObservation> {
  const result = await runAzCliAsync([
    "deployment", "group", "show", "--name", reference.name,
    "--resource-group", reference.resourceGroup, "--subscription", reference.subscription,
    "--query", DEPLOYMENT_QUERY, "-o", "json",
  ], { timeout: options.timeoutMs ?? 30_000, signal: options.signal });
  const diagnostic = azureCliDiagnostic(result, "deployment-state", options.secretValues);
  const unknown = (reason: DeploymentObservation["reason"]): DeploymentObservation => ({
    state: "unknown", reference, reason, errors: [], diagnostic,
  });
  if (result.status !== 0 || result.failureKind) {
    if (result.failureKind === "cancelled") return unknown("cancelled");
    return unknown(/DeploymentNotFound|ResourceGroupNotFound/i.test(`${result.stderr}\n${result.stdout}`) ? "not-found" : "query-failed");
  }
  if (result.stdoutTruncated) return unknown("invalid-response");
  let parsed: Record<string, unknown> | null;
  try { parsed = record(JSON.parse(result.stdout)); } catch { return unknown("invalid-response"); }
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.state !== "string" || typeof parsed.correlationId !== "string") {
    return unknown("invalid-response");
  }
  if (parsed.id.toLowerCase() !== deploymentId(reference).toLowerCase()
    || (reference.correlationId && parsed.correlationId !== reference.correlationId)
    || (reference.templateHash && parsed.templateHash !== reference.templateHash)) {
    return unknown("identity-changed");
  }
  if (reference.previousCorrelationId && parsed.correlationId === reference.previousCorrelationId) {
    return unknown("not-yet-observed");
  }
  const states: Record<string, DeploymentObservation["state"]> = {
    accepted: "Accepted", running: "Running", creating: "Running", updating: "Running",
    succeeded: "Succeeded", failed: "Failed", canceled: "Canceled", cancelled: "Canceled",
  };
  const state = states[parsed.state.toLowerCase()];
  if (!state) return unknown("invalid-response");
  return {
    state,
    reference: {
      ...reference,
      id: parsed.id,
      correlationId: parsed.correlationId,
      ...(typeof parsed.templateHash === "string" ? { templateHash: parsed.templateHash } : {}),
    },
    errors: extractAzureErrors(parsed.error, options.secretValues),
    diagnostic,
  };
}

export async function waitForAzureDeployment(
  reference: DeploymentReference,
  options: {
    deadline: number;
    signal?: AbortSignal;
    pollIntervalMs?: number;
    onObservation?: (observation: DeploymentObservation) => void;
    secretValues?: readonly string[];
    queryTimeoutMs?: number;
  }
): Promise<DeploymentObservation> {
  let observation: DeploymentObservation;
  do {
    const remaining = options.deadline - Date.now();
    // Even when the wait budget is exhausted, one bounded read can identify an accepted submission.
    observation = await queryAzureDeployment(reference, {
      timeoutMs: remaining > 0 ? Math.min(options.queryTimeoutMs ?? 30_000, remaining) : options.queryTimeoutMs ?? 30_000,
      signal: options.signal,
      secretValues: options.secretValues,
    });
    if (observation.state !== "unknown") reference = observation.reference;
    options.onObservation?.(observation);
    if (observation.state === "Succeeded" || observation.state === "Failed" || observation.state === "Canceled") return observation;
    if (observation.state === "unknown" && observation.reason !== "not-yet-observed" && observation.reason !== "not-found") return observation;
    if (Date.now() >= options.deadline || options.signal?.aborted) return observation;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(options.pollIntervalMs ?? 5_000, Math.max(options.deadline - Date.now(), 0)));
      options.signal?.addEventListener("abort", done, { once: true });
      if (options.signal?.aborted) done();
    });
  } while (!options.signal?.aborted);
  return observation;
}

export async function queryDeploymentOperationErrors(reference: DeploymentReference, secretValues: readonly string[] = [], signal?: AbortSignal): Promise<{
  errors: AzureDeploymentError[];
  diagnostic: AzureCliDiagnostic;
}> {
  const result = await runAzCliAsync([
    "deployment", "operation", "group", "list",
    "--resource-group", reference.resourceGroup, "--name", reference.name, "--subscription", reference.subscription,
    "--query", "[?properties.provisioningState=='Failed' || properties.provisioningState=='Canceled'].{error:properties.statusMessage}",
    "-o", "json",
  ], { timeout: 30_000, signal });
  const errors: AzureDeploymentError[] = [];
  if (result.status === 0 && !result.failureKind && !result.stdoutTruncated) {
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (Array.isArray(parsed)) parsed.slice(0, 20).forEach((item) => errors.push(...extractAzureErrors(item, secretValues)));
    } catch { /* The separate diagnostic explicitly records an unreadable operations response. */ }
  }
  return { errors: errors.slice(0, 20), diagnostic: azureCliDiagnostic(result, "deployment-operations", secretValues) };
}
