import * as fs from "fs";
import * as path from "path";
import { loadProjectManifest, buildProjectManifest, ProjectManifest, ProjectManifestEntity, SWALLOWKIT_MANIFEST_PATH } from "./manifest";
import { toCamelCase, toKebabCase } from "../scaffold/model-parser";

export type ProjectViolationSeverity = "error" | "warning";

export interface ProjectViolation {
  code: string;
  severity: ProjectViolationSeverity;
  message: string;
  location?: {
    path?: string;
    entity?: string;
  };
  suggestedFix?: string;
}

export interface ProjectValidationResult {
  manifest: ProjectManifest;
  manifestSource: "file" | "reconstructed";
  diagnostics: string[];
  violations: ProjectViolation[];
}

function pushViolation(
  violations: ProjectViolation[],
  violation: ProjectViolation
): void {
  violations.push(violation);
}

function hasScaffoldedEntities(manifest: ProjectManifest): boolean {
  return manifest.entities.length > 0;
}

function validateRequiredPaths(manifest: ProjectManifest, violations: ProjectViolation[]): void {
  const requiredModules = manifest.modules.filter((module) =>
    ["shared-models", "bff", "functions"].includes(module.kind)
  );

  for (const module of requiredModules) {
    if (!module.exists) {
      pushViolation(violations, {
        code: "missing-required-module",
        severity: "error",
        message: `Required module path is missing: ${module.rootPath}`,
        location: { path: module.rootPath },
        suggestedFix: "Initialize or restore the standard SwallowKit project directories before generating code.",
      });
    }
  }

  if (hasScaffoldedEntities(manifest) && !manifest.artifacts.callFunctionHelperExists) {
    pushViolation(violations, {
      code: "missing-call-function-helper",
      severity: "warning",
      message: "BFF helper lib/api/call-function.ts is missing.",
      location: { path: manifest.artifacts.callFunctionHelperPath },
      suggestedFix: "Run scaffold to regenerate the BFF helper.",
    });
  }
}

function validateSchemaNaming(entity: ProjectManifestEntity, violations: ProjectViolation[]): void {
  const expectedFileName = `${toKebabCase(entity.name)}.ts`;
  if (!entity.filePath.endsWith(expectedFileName)) {
    pushViolation(violations, {
      code: "naming-model-file",
      severity: "warning",
      message: `Model file should match the entity name in kebab-case: expected ${expectedFileName}.`,
      location: { path: entity.filePath, entity: entity.name },
      suggestedFix: `Rename the model file to ${expectedFileName} to keep generator conventions deterministic.`,
    });
  }

  const camelSchema = `${toCamelCase(entity.name)}Schema`;
  if (entity.schemaName !== entity.name && entity.schemaName !== camelSchema) {
    pushViolation(violations, {
      code: "naming-schema-export",
      severity: "warning",
      message: `Schema export should be ${entity.name} or ${camelSchema}. Found ${entity.schemaName}.`,
      location: { path: entity.filePath, entity: entity.name },
      suggestedFix: "Use either the PascalCase Zod export or the camelCase Schema suffix pattern supported by SwallowKit.",
    });
  }
}

function validateGeneratedArtifacts(manifest: ProjectManifest, violations: ProjectViolation[]): void {
  for (const route of manifest.routes.filter((candidate) => candidate.kind === "entity")) {
    if (!route.exists) {
      pushViolation(violations, {
        code: route.surface === "bff" ? "missing-bff-route" : "missing-functions-artifact",
        severity: "warning",
        message: `${route.surface === "bff" ? "BFF route" : "Functions artifact"} is missing for ${route.entityName}.`,
        location: {
          path: route.filePath,
          entity: route.entityName,
        },
        suggestedFix: `Run scaffold for ${route.entityName} to regenerate ${route.surface === "bff" ? "API routes" : "Functions code"}.`,
      });
    }
  }

  if (
    hasScaffoldedEntities(manifest) &&
    manifest.backendLanguage !== "typescript" &&
    manifest.artifacts.openApiSpecs.length === 0
  ) {
    pushViolation(violations, {
      code: "missing-openapi-artifacts",
      severity: "warning",
      message: `No OpenAPI export or native schema artifacts were found for ${manifest.backendLanguage} backend generation.`,
      location: { path: "functions/openapi" },
      suggestedFix: "Run scaffold to regenerate the OpenAPI export and native backend schema artifacts.",
    });
  }
}

function validateLayeringViolations(projectRoot: string, violations: ProjectViolation[]): void {
  const apiDir = path.join(projectRoot, "app", "api");
  const modelsDir = path.join(projectRoot, "shared", "models");

  if (fs.existsSync(apiDir)) {
    for (const filePath of walkFiles(apiDir, [".ts", ".tsx"])) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.includes("@azure/cosmos") || content.match(/from\s+['"].*functions\//)) {
        pushViolation(violations, {
          code: "forbidden-bff-dependency",
          severity: "error",
          message: "BFF files must not depend directly on Azure Cosmos or Functions implementation paths.",
          location: { path: path.relative(projectRoot, filePath).replace(/\\/g, "/") },
          suggestedFix: "Keep app/api as a pure BFF layer and call the backend through generated helpers instead.",
        });
      }
    }
  }

  if (fs.existsSync(modelsDir)) {
    for (const filePath of walkFiles(modelsDir, [".ts", ".tsx"])) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.match(/from\s+['"].*(app\/|functions\/|lib\/api\/)/)) {
        pushViolation(violations, {
          code: "forbidden-model-layer-import",
          severity: "error",
          message: "Shared models must not import from app/, functions/, or lib/api/ layers.",
          location: { path: path.relative(projectRoot, filePath).replace(/\\/g, "/") },
          suggestedFix: "Keep shared/models framework-agnostic so generators can reuse them across all layers.",
        });
      }
    }
  }
}

function validateManifestDrift(
  projectRoot: string,
  loadedManifest: ProjectManifest,
  rebuiltManifest: ProjectManifest,
  violations: ProjectViolation[]
): void {
  const sameEntitySet = JSON.stringify(loadedManifest.entities.map((entity) => entity.name).sort()) ===
    JSON.stringify(rebuiltManifest.entities.map((entity) => entity.name).sort());
  const sameRouteSet = JSON.stringify(loadedManifest.routes.map((route) => route.name).sort()) ===
    JSON.stringify(rebuiltManifest.routes.map((route) => route.name).sort());

  if (!sameEntitySet || !sameRouteSet) {
    pushViolation(violations, {
      code: "manifest-out-of-date",
      severity: "warning",
      message: `${SWALLOWKIT_MANIFEST_PATH} is out of date with the current project structure.`,
      location: { path: SWALLOWKIT_MANIFEST_PATH },
      suggestedFix: "Run a SwallowKit generator command or refresh the manifest so inspection and validation use current metadata.",
    });
  }
}

function walkFiles(directory: string, extensions: string[]): string[] {
  const collected: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...walkFiles(entryPath, extensions));
      continue;
    }

    if (extensions.some((extension) => entry.name.endsWith(extension))) {
      collected.push(entryPath);
    }
  }

  return collected;
}

const VERIFIER_STUB_MARKER = /External token verifier(?: for \S+)? is not configured/;

/**
 * external-token スキームの verifier が生成スタブのまま (fail-closed throw のみ) だと
 * typecheck / verify は通るのに実行時は必ず 401/503 になる。
 * 「認証は生成されたが動かない」状態を warning として可視化する。
 */
function validateExternalTokenVerifierStubs(projectRoot: string, manifest: ProjectManifest, violations: ProjectViolation[]): void {
  const auth = manifest.auth;
  const hasExternalToken =
    auth?.provider === "external-token" ||
    Object.values(auth?.schemes ?? {}).some((scheme) => scheme.provider === "external-token");
  if (!hasExternalToken) return;

  const candidates: string[] = [
    path.join("functions", "src", "auth", "external-token-verifier.ts"),
    path.join("functions", "Auth", "ExternalTokenVerifier.cs"),
    path.join("functions", "auth", "external_token_verifier.py"),
  ];
  const schemeDirs = [
    { root: path.join("functions", "src", "auth", "schemes"), file: "verifier.ts" },
    { root: path.join("functions", "Auth", "Schemes"), file: "ExternalTokenVerifier.cs" },
    { root: path.join("functions", "auth", "schemes"), file: "verifier.py" },
  ];
  for (const { root, file } of schemeDirs) {
    const absoluteRoot = path.join(projectRoot, root);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(root, entry.name, file));
    }
  }

  for (const relativePath of candidates) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, "utf-8");
    if (VERIFIER_STUB_MARKER.test(content)) {
      pushViolation(violations, {
        code: "auth-verifier-stub",
        severity: "warning",
        message:
          "External token verifier is still the generated stub; it fails closed, so external-token authentication cannot succeed at runtime.",
        location: { path: relativePath.replace(/\\/g, "/") },
        suggestedFix: "Implement the verifier against your identity provider. The file is yours to edit (generated-once).",
      });
    }
  }
}

export async function validateProject(projectRoot: string = process.cwd()): Promise<ProjectValidationResult> {
  const loaded = await loadProjectManifest(projectRoot);
  const rebuilt = await buildProjectManifest(projectRoot);
  const violations: ProjectViolation[] = [];

  validateRequiredPaths(loaded.manifest, violations);

  for (const error of loaded.manifest.configValidation.errors) {
    pushViolation(violations, {
      code: "config-validation",
      severity: "error",
      message: error,
      location: loaded.manifest.configPath ? { path: loaded.manifest.configPath } : undefined,
      suggestedFix: "Fix the SwallowKit config so generators and validators have a stable project definition.",
    });
  }

  const namedPolicies = loaded.manifest.auth?.authorization?.policies ?? {};
  for (const entity of loaded.manifest.entities) {
    const policy = entity.authPolicy;
    if (!policy) continue;
    const references = [policy.policy, typeof policy.read === "string" ? policy.read : undefined, typeof policy.write === "string" ? policy.write : undefined].filter((value): value is string => Boolean(value));
    for (const name of references) {
      if (!namedPolicies[name]) pushViolation(violations, {
        code: "undefined-auth-policy",
        severity: "error",
        message: `Model '${entity.name}' references undefined authorization policy '${name}'.`,
        location: { path: entity.filePath, entity: entity.name },
        suggestedFix: `Define auth.authorization.policies.${name} or update the model authPolicy reference.`,
      });
    }
  }

  for (const entity of loaded.manifest.entities) {
    validateSchemaNaming(entity, violations);
  }

  validateGeneratedArtifacts(loaded.manifest, violations);
  validateLayeringViolations(projectRoot, violations);
  validateExternalTokenVerifierStubs(projectRoot, loaded.manifest, violations);

  if (loaded.source === "file") {
    validateManifestDrift(projectRoot, loaded.manifest, rebuilt.manifest, violations);
  }

  return {
    manifest: loaded.manifest,
    manifestSource: loaded.source,
    diagnostics: [...loaded.diagnostics, ...rebuilt.diagnostics],
    violations: violations.sort((left, right) => left.code.localeCompare(right.code)),
  };
}
