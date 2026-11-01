import type { AzCliResult } from "./azure-cli";

const SENSITIVE_KEY = /outputs|parameters|password|secret|token|authorization|connection.?string|accountkey|api.?key|functions?.?key|client.?secret|access.?key|primary.?key|secondary.?key/i;

export function redactAzureText(text: string, secretValues: readonly string[] = []): string {
  const redactValues = (value: string) => {
    for (const secret of secretValues) {
      if (secret) value = value.split(secret).join("[REDACTED]").split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
    }
    return value;
  };
  text = redactValues(text);
  let value = text;
  try {
    const redact = (entry: unknown): unknown => {
      if (typeof entry === "string") return redactPlainText(redactValues(entry));
      if (Array.isArray(entry)) return entry.map(redact);
      if (entry && typeof entry === "object") {
        return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item)]));
      }
      return entry;
    };
    value = JSON.stringify(redact(JSON.parse(text)));
  } catch {
    // An incomplete deployment payload cannot be safely projected/redacted.
    if (/"(?:outputs|parameters)"\s*:/i.test(text)) return "[Azure payload omitted: may contain secrets]";
    value = redactPlainText(text);
  }
  return value;
}

function redactPlainText(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/(?:AccountEndpoint|DefaultEndpointsProtocol)=[^\r\n"']+/gi, "[connection string REDACTED]")
    .replace(/((?:api[-_ ]?key|functions?[-_ ]?key|accountkey|password|client[-_ ]?secret|secret|token|access[-_ ]?key|primary[-_ ]?key|secondary[-_ ]?key|authorization)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:code|sig|token|key|secret|password)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
}

export interface AzureCliDiagnostic {
  phase: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  failureKind?: AzCliResult["failureKind"];
  errorCode?: string;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export function azureCliDiagnostic(result: AzCliResult, phase: string, secretValues: readonly string[] = []): AzureCliDiagnostic {
  const stdout = result.stdoutTruncated ? "[stdout omitted: capture limit reached]" : redactAzureText(result.stdout, secretValues);
  const stderr = result.stderrTruncated ? "[stderr omitted: capture limit reached]" : redactAzureText(result.stderr, secretValues);
  return {
    phase,
    exitCode: result.status,
    signal: result.signal ?? null,
    elapsedMs: result.elapsedMs,
    ...(result.failureKind ? { failureKind: result.failureKind } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    stdout: stdout.slice(0, 4_000),
    stderr: stderr.slice(0, 4_000),
    outputTruncated: result.stdoutTruncated || result.stderrTruncated || stdout.length > 4_000 || stderr.length > 4_000,
  };
}

export function formatAzureDiagnostic(diagnostic: AzureCliDiagnostic): string {
  return [
    `az ${diagnostic.phase}: exit=${diagnostic.exitCode ?? "unknown"}, signal=${diagnostic.signal ?? "none"}, kind=${diagnostic.failureKind ?? "none"}, elapsed=${diagnostic.elapsedMs}ms${diagnostic.errorCode ? `, error=${diagnostic.errorCode}` : ""}${diagnostic.outputTruncated ? ", output omitted/truncated" : ""}`,
    ...(diagnostic.stdout ? [`stdout: ${diagnostic.stdout}`] : []),
    ...(diagnostic.stderr ? [`stderr: ${diagnostic.stderr}`] : []),
  ].join("\n");
}
