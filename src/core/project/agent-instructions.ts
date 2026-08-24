import * as fs from "fs";
import * as path from "path";
import { BackendLanguage } from "../../types";
import { PackageManager } from "../../utils/package-manager";

export interface AgentInstructionContext {
  projectName: string;
  backendLanguage: BackendLanguage;
  packageManager: PackageManager;
}

export interface AgentInstructionDocuments {
  agentsMd: string;
  claudeMd: string;
  copilotInstructions: string;
  pathSpecificInstructions: Record<string, string>;
}

export const AGENT_TEMPLATE_FILES = {
  agentsMd: "AGENTS.md",
  claudeMd: "CLAUDE.md",
  copilotInstructions: "copilot-instructions.md",
  sharedModelsInstructions: "shared-models.instructions.md",
  bffRoutesInstructions: "bff-routes.instructions.md",
  azureFunctionsInstructions: "azure-functions.instructions.md",
} as const;

const BACKEND_LANGUAGE_LABELS: Record<BackendLanguage, string> = {
  typescript: "TypeScript",
  csharp: "C#",
  python: "Python",
};

function getTemplatePath(fileName: string): string {
  const candidates = [
    path.join(__dirname, "agent-templates", fileName),
    path.join(__dirname, "../../../src/core/project/agent-templates", fileName),
  ];
  const templatePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!templatePath) {
    throw new Error(`Agent instruction template not found: ${fileName}`);
  }
  return templatePath;
}

export function readAgentInstructionTemplate(fileName: string): string {
  return fs.readFileSync(getTemplatePath(fileName), "utf-8").replace(/\r\n/g, "\n");
}

function getFunctionsStructureLine(backendLanguage: BackendLanguage): string {
  if (backendLanguage === "typescript") {
    return "│   └── src/               # HTTP trigger handlers with Cosmos DB bindings";
  }
  if (backendLanguage === "csharp") {
    return "│   ├── Crud/              # C# HTTP trigger handlers\n│   └── generated/         # Native-generated C# schema assets";
  }
  return "│   ├── blueprints/        # Python HTTP trigger handlers\n│   └── generated/         # Native-generated Python schema assets";
}

function getBackendRules(backendLanguage: BackendLanguage): string {
  if (backendLanguage === "typescript") {
    return [
      "- All backend business logic and data access live in `functions/src/`.",
      "- Prefer Azure Functions Cosmos DB input/output bindings for reads and writes.",
      "- Use the Cosmos DB SDK directly only where bindings do not support the operation, such as deletes.",
      "- Validate data against the shared Zod schemas before persistence.",
    ].join("\n");
  }
  return [
    "- All backend business logic and data access live in `functions/`.",
    `- SwallowKit derives OpenAPI and native ${BACKEND_LANGUAGE_LABELS[backendLanguage]} schema assets from the Zod source of truth.`,
    "- Keep custom business logic in ai-authored locations identified by the current boundary contract.",
  ].join("\n");
}

function interpolateTemplate(template: string, context: AgentInstructionContext): string {
  const runCmd = context.packageManager === "pnpm" ? "pnpm" : "npx";
  const replacements: Record<string, string> = {
    projectName: context.projectName,
    backendLanguageLabel: BACKEND_LANGUAGE_LABELS[context.backendLanguage],
    functionsStructureLine: getFunctionsStructureLine(context.backendLanguage),
    backendRules: getBackendRules(context.backendLanguage),
    pm: context.packageManager,
    runCmd,
  };

  const result = template.replace(/\{\{([A-Za-z]+)\}\}/g, (placeholder, key: string) => {
    const replacement = replacements[key];
    if (replacement === undefined) {
      throw new Error(`Unknown Agent instruction placeholder: ${placeholder}`);
    }
    return replacement;
  });

  if (/\{\{[^}]+\}\}/.test(result)) {
    throw new Error("Unresolved Agent instruction template placeholder");
  }
  return result;
}

function buildTemplate(fileName: string, context: AgentInstructionContext): string {
  return interpolateTemplate(readAgentInstructionTemplate(fileName), context);
}

export function buildAgentsMd(context: AgentInstructionContext): string {
  return buildTemplate(AGENT_TEMPLATE_FILES.agentsMd, context);
}

export function buildClaudeMd(context: AgentInstructionContext): string {
  return buildTemplate(AGENT_TEMPLATE_FILES.claudeMd, context);
}

export function buildCopilotInstructions(context: AgentInstructionContext): string {
  return buildTemplate(AGENT_TEMPLATE_FILES.copilotInstructions, context);
}

export function buildPathSpecificInstructions(
  context: AgentInstructionContext
): Record<string, string> {
  return {
    [AGENT_TEMPLATE_FILES.sharedModelsInstructions]: buildTemplate(
      AGENT_TEMPLATE_FILES.sharedModelsInstructions,
      context
    ),
    [AGENT_TEMPLATE_FILES.bffRoutesInstructions]: buildTemplate(
      AGENT_TEMPLATE_FILES.bffRoutesInstructions,
      context
    ),
    [AGENT_TEMPLATE_FILES.azureFunctionsInstructions]: buildTemplate(
      AGENT_TEMPLATE_FILES.azureFunctionsInstructions,
      context
    ),
  };
}

export function buildAgentInstructionDocuments(
  context: AgentInstructionContext
): AgentInstructionDocuments {
  return {
    agentsMd: buildAgentsMd(context),
    claudeMd: buildClaudeMd(context),
    copilotInstructions: buildCopilotInstructions(context),
    pathSpecificInstructions: buildPathSpecificInstructions(context),
  };
}

export function writeAgentInstructionFiles(
  projectDir: string,
  context: AgentInstructionContext
): AgentInstructionDocuments {
  const documents = buildAgentInstructionDocuments(context);
  fs.writeFileSync(path.join(projectDir, "AGENTS.md"), documents.agentsMd, "utf-8");
  fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), documents.claudeMd, "utf-8");

  const githubDir = path.join(projectDir, ".github");
  const instructionsDir = path.join(githubDir, "instructions");
  fs.mkdirSync(instructionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(githubDir, "copilot-instructions.md"),
    documents.copilotInstructions,
    "utf-8"
  );
  for (const [fileName, content] of Object.entries(documents.pathSpecificInstructions)) {
    fs.writeFileSync(path.join(instructionsDir, fileName), content, "utf-8");
  }
  return documents;
}
