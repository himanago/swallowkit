import * as fs from "fs";
import * as path from "path";
import { createAiAgentFiles } from "../cli/commands/init";
import * as mcpConfig from "../core/project/mcp-config";
import { parseSeedDocuments, getContainerNameForModel } from "../cli/commands/dev-seeds";
import { BackendLanguage, FrontendFramework } from "../types";
import { PackageManager, getCommands } from "../utils/package-manager";
import { buildWorkflowDocs } from "../core/project/workflows";
import {
  AGENT_TEMPLATE_FILES,
  AgentInstructionContext,
  buildAgentsMd,
  buildClaudeMd,
  buildCopilotInstructions,
  buildPathSpecificInstructions,
  readAgentInstructionTemplate,
  writeAgentInstructionFiles,
} from "../core/project/agent-instructions";

const representativeContext: AgentInstructionContext = {
  projectName: "sample-app",
  backendLanguage: "typescript",
  packageManager: "npm",
};

const repositoryRoot = path.resolve(__dirname, "../..");
const frontends: FrontendFramework[] = ["nextjs", "react"];
const backendLanguages: BackendLanguage[] = ["typescript", "csharp", "python"];
const packageManagers: PackageManager[] = ["npm", "pnpm"];
const persistentModelContexts: AgentInstructionContext[] = frontends.flatMap((frontend) =>
  backendLanguages.flatMap((backendLanguage) =>
    packageManagers.map((packageManager) => ({
      projectName: "persistent-app",
      frontend,
      backendLanguage,
      packageManager,
    }))
  )
);

describe("coding-agent instruction contract", () => {
  it("applies SwallowKit before implementation and composes with external processes", () => {
    const agentsMd = buildAgentsMd(representativeContext);

    expect(agentsMd).toContain("discovery, requirements clarification");
    expect(agentsMd).toContain("specification, planning, ticket decomposition");
    expect(agentsMd).toContain("not only during code generation");
    expect(agentsMd).toContain("How SwallowKit Fits Into the Development Process");
    expect(agentsMd).toContain("does **not** own the overall software development process");
    expect(agentsMd).toContain("External development-process skills and SwallowKit are intended to compose");
  });

  it("requires inspection before questions or design instead of remembered capabilities", () => {
    const agentsMd = buildAgentsMd(representativeContext);

    expect(agentsMd).toContain("Do Not Assume SwallowKit Capabilities From Memory");
    expect(agentsMd).toContain("Inspect Before Asking or Designing");
    expect(agentsMd).toContain("should be answered by the agent instead of being delegated to the human");
    expect(agentsMd).toContain("npx swallowkit machine inspect project");
    expect(agentsMd).toContain("npx swallowkit machine inspect entities");
    expect(agentsMd).toContain("npx swallowkit machine inspect routes");
    expect(agentsMd).toContain("npx swallowkit machine inspect boundaries");
  });

  it("defines ownership, vertical slices, plan/apply, verification, and approval gates", () => {
    const agentsMd = buildAgentsMd(representativeContext);

    expect(agentsMd).toContain("### ai-authored");
    expect(agentsMd).toContain("### deterministic");
    expect(agentsMd).toContain("### shared");
    expect(agentsMd).toContain("vertical slices");
    expect(agentsMd).toContain("Do not split work into horizontal tickets");
    expect(agentsMd).toContain("Deterministic Changes: Plan → Apply → Verify");
    expect(agentsMd).toContain("npx swallowkit machine plan scaffold <model>");
    expect(agentsMd).toContain("Verification Is a Completion Gate");
    expect(agentsMd).toContain("semantic code review answers different questions");
    expect(agentsMd).toContain("When the status is `requires-human`, stop");
    expect(agentsMd).toContain("machine inspect provision --plan <runId> --wait-seconds 300");
    expect(agentsMd).toContain("outcome: \"succeeded\"");
    expect(agentsMd).toContain("Never re-submit Bicep");
    expect(agentsMd).toContain("must not switch to normal CLI to bypass it");
    expect(agentsMd).toContain("never bypass its\napproval gate");
  });

  it("uses MCP first and the package-manager-specific machine fallback", () => {
    const npmDocument = buildAgentsMd(representativeContext);
    const pnpmDocument = buildAgentsMd({
      ...representativeContext,
      packageManager: "pnpm",
    });

    expect(npmDocument).toContain("Prefer the `swallowkit_*` MCP tools when available");
    expect(npmDocument).toContain("npx swallowkit machine ...");
    expect(pnpmDocument).toContain("pnpm exec swallowkit machine ...");
    expect(pnpmDocument).not.toContain("npx swallowkit machine ...");
  });

  it("keeps Claude and Copilot as self-identifying adapters to canonical AGENTS.md", () => {
    const adapters = [
      buildClaudeMd(representativeContext),
      buildCopilotInstructions(representativeContext),
    ];

    for (const adapter of adapters) {
      expect(adapter).toContain("This is a **SwallowKit** project");
      expect(adapter).toContain("root `AGENTS.md`");
      expect(adapter).toContain("canonical project contract");
      expect(adapter).toContain("discovery");
      expect(adapter).toContain("specification");
      expect(adapter).toContain("planning");
      expect(adapter).toContain("Never hand-edit deterministic SwallowKit-managed artifacts");
      expect(adapter).toContain("SwallowKit verification");
      expect(adapter).toContain("approval");
    }
  });

  it("aligns path-specific instructions with the machine plan/apply workflow", () => {
    const instructions = buildPathSpecificInstructions(representativeContext);
    const sharedModels = instructions[AGENT_TEMPLATE_FILES.sharedModelsInstructions];

    expect(sharedModels).toContain("swallowkit-modify-model");
    expect(sharedModels).toContain(".swallowkit/workflows/modify-model.md");
    expect(sharedModels).toContain("inspect drift → plan scaffold → apply scaffold → verify project");
    expect(sharedModels).toContain("Prefer the equivalent `swallowkit_*` MCP tools");

    for (const content of Object.values(instructions)) {
      expect(content).toContain("root `AGENTS.md` is the canonical contract");
      expect(content).toMatch(/Never|never|do not/);
      expect(content).toContain("requires-human");
      expect(content).not.toMatch(/run `(?:npx|pnpm )?swallowkit scaffold/);
      expect(content).not.toContain("rerunning `swallowkit scaffold`");
    }
  });

  it("writes the generated integration files from the builders", () => {
    const tempDir = fs.mkdtempSync(path.join(repositoryRoot, ".tmp-agent-docs-"));
    try {
      const documents = writeAgentInstructionFiles(tempDir, representativeContext);
      expect(fs.readFileSync(path.join(tempDir, "AGENTS.md"), "utf-8")).toBe(documents.agentsMd);
      expect(fs.readFileSync(path.join(tempDir, "CLAUDE.md"), "utf-8")).toBe(documents.claudeMd);
      expect(
        fs.readFileSync(path.join(tempDir, ".github", "copilot-instructions.md"), "utf-8")
      ).toBe(documents.copilotInstructions);
      for (const [fileName, content] of Object.entries(documents.pathSpecificInstructions)) {
        expect(
          fs.readFileSync(path.join(tempDir, ".github", "instructions", fileName), "utf-8")
        ).toBe(content);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each(persistentModelContexts)(
    "writes the init persistent-model contract for $frontend/$backendLanguage/$packageManager",
    (context) => {
      const tempDir = fs.mkdtempSync(path.join(repositoryRoot, ".tmp-persistent-agent-docs-"));
      const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
      const lookup = jest.spyOn(mcpConfig, "lookupPublishedLatestVersion").mockReturnValue("1.1.4");
      try {
        createAiAgentFiles(tempDir, context.projectName, context.backendLanguage, context.packageManager, context.frontend);
        const agents = fs.readFileSync(path.join(tempDir, "AGENTS.md"), "utf-8").replace(/\s+/g, " ");
        const sharedModels = fs.readFileSync(
          path.join(tempDir, ".github", "instructions", AGENT_TEMPLATE_FILES.sharedModelsInstructions),
          "utf-8"
        );
        const runCmd = getCommands(context.packageManager).exec;
        for (const document of [agents, sharedModels]) {
          expect(document).toContain(`${runCmd} swallowkit machine plan model <model> --overwrite never`);
          expect(document).toContain(`${runCmd} swallowkit machine apply model --plan <planId>`);
          expect(document).toContain(`${runCmd} swallowkit machine plan model-infrastructure <model>`);
          expect(document).toContain(`${runCmd} swallowkit machine apply model --plan <planId>`);
          expect(document).toContain("custom APIs");
          expect(document).toContain("required local migration is missing or stale");
          expect(document).not.toMatch(/\{\{[A-Za-z]+\}\}/);
        }
        expect(agents).toContain("A hand-written model alone is not complete");
        expect(agents).toContain("registered Cosmos container migration");
        expect(agents).toContain("do **not** scaffold unnecessary CRUD");
        expect(agents).toContain("`--api-only` skips UI only");
        expect(agents).toContain("`machine apply scaffold --plan <planId>`");
        expect(agents).toContain(`${runCmd} swallowkit machine verify project`);
        for (const inspect of ["entities", "infra", "artifacts", "drift"]) {
          expect(agents).toContain(`machine inspect ${inspect}`);
        }
        for (const record of ["infra/migrations/manifest.json", ".swallowkit/artifacts.json", "sourceModel"]) {
          expect(agents).toContain(record);
        }
        expect(agents).toContain("container name and partition key");
        expect(agents).toContain("baseline-owned container");
        expect(agents).toContain("External `connectorConfig` models");
        expect(agents).toContain("state the reason and the pending");
        expect(agents).toContain("`verify project` fails while a required local migration is missing or stale");
        expect(sharedModels).toContain("verify fails while a");
        expect(agents).toContain("Generation is local, not Azure provisioning");

        for (const rule of [
          "use Azure Cosmos DB in production and Cosmos DB Emulator locally",
          "not bypassed with File/JSON/SQLite/InMemory application storage",
          "Explicit unit-test doubles are allowed",
          "not database evidence",
          "standard connection settings and effective database name",
          "worktree-isolated name resolved by `swallowkit dev`",
          "unnecessary custom database/path/storage options or production startup flags",
          "Explicit alternate-persistence requirements",
          "External `connectorConfig` models use the configured connector rather than Cosmos DB",
          "dev-seeds/<environment>/learning-profile.json",
          "not `LearningProfiles.json`",
          "top-level array of documents",
          "basenames, containers, and inserted counts",
          "All-skipped files",
          "Do not inject demo data on HTTP requests, backend startup, or an empty database",
          "bespoke reset APIs/UI, importers, or demo flags",
          "Offline fixture generation is allowed",
          "not invoked by the backend",
          "Legitimate business initialization is distinct",
          "readiness probes are mechanical evidence",
          "actual application through the configured frontend's same-origin BFF, standalone Functions, and database",
          "restart the application without re-seeding",
          "validation failures, nonexistent IDs",
          "authentication/authorization paths",
          "Emulator versus Azure Cosmos DB",
          "mock AI versus real AI service calls",
          "fixed development identity versus real authentication",
          "passed, skipped, or warned",
          "HTTP success does not clear `AzureWebJobsStorage` warnings",
          "blockers or explicitly unverified behavior",
          "A documentation-only change does not require live database verification",
          "Inspect existing Emulator/server processes and occupied ports",
          "Do not restart user services to free a port",
          "actual endpoint, effective database name, and target containers",
          "verify isolation from resolved settings and logs",
          "Existing production, shared, or user data requires the applicable human approval",
          "Do not disable TLS validation",
          "configured HTTP/HTTPS endpoint",
          "never bulk-kill by process name",
          "Disclose local untracked configuration and test database leftovers",
          "Never invent or implicitly grant human approval",
          "must not switch to normal CLI to bypass it",
          "Authentication is a **plan/apply operation**",
          "Never hand-write `auth.schemes` entries",
          "Do not bypass plan/apply by manually editing deterministic artifacts",
        ]) {
          expect(agents).toContain(rule);
        }
        expect(agents).toContain(`${runCmd} swallowkit dev --seed-env <environment>`);
        expect(agents).toContain(`${runCmd} swallowkit dev`);
        if (context.frontend === "react") {
          expect(agents).toContain("Use http://localhost:4280 for the app");
          expect(agents).toContain("managed BFF (7073)");
          expect(agents).toContain("BFF (SWA managed Functions)");
        } else {
          expect(agents).toContain("Use http://localhost:3000 for the app");
          expect(agents).toContain("BFF (Next.js API routes)");
          expect(agents).not.toContain("7073");
          expect(agents).not.toContain("runs Vite");
        }
        for (const adapterPath of ["CLAUDE.md", path.join(".github", "copilot-instructions.md")]) {
          const adapter = fs.readFileSync(path.join(tempDir, adapterPath), "utf-8");
          expect(adapter).toContain("root `AGENTS.md`");
          expect(adapter).toContain("runtime evidence");
          expect(adapter).not.toContain("learning-profile.json");
        }
        const backendRules = fs.readFileSync(
          path.join(tempDir, ".github", "instructions", AGENT_TEMPLATE_FILES.azureFunctionsInstructions), "utf-8"
        );
        expect(backendRules).toContain("Follow root `AGENTS.md` for the persistence contract");
        expect(backendRules).toContain(`Backend language: ${context.backendLanguage === "csharp" ? "C#" : context.backendLanguage === "python" ? "Python" : "TypeScript"}.`);
        for (const [fileName, skill] of [
          ["add-model.md", "swallowkit-add-model"],
          ["modify-model.md", "swallowkit-modify-model"],
          ["verify-and-repair.md", "swallowkit-verify-repair"],
        ]) {
          const runbook = fs.readFileSync(path.join(tempDir, ".swallowkit", "workflows", fileName), "utf-8");
          const skillDoc = fs.readFileSync(path.join(tempDir, ".github", "skills", skill, "SKILL.md"), "utf-8");
          for (const document of [runbook, skillDoc]) {
            expect(document).toContain("root `AGENTS.md`");
            expect(document).toContain("runtime");
            expect(document).not.toContain("learning-profile.json");
          }
        }
        expect(lookup).toHaveBeenCalledTimes(1);
      } finally {
        lookup.mockRestore();
        log.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  );

  it("uses a parseable array example and distinguishes seed filenames from containers", () => {
    const agents = buildAgentsMd(representativeContext);
    const example = agents.match(/```json\n([\s\S]*?)\n```/);
    expect(example).not.toBeNull();
    const documents = parseSeedDocuments(example![1], "dev-seeds/test/learning-profile.json");
    expect(Array.isArray(JSON.parse(example![1]))).toBe(true);
    expect(documents).toEqual([{ id: "profile-1", learnerId: "learner-1", displayName: "Example" }]);
    expect(getContainerNameForModel({ name: "LearningProfile" })).toBe("LearningProfiles");
  });

  it.each(["npx", "pnpm exec"])("aligns the add-model runbook and skill content for %s", (runCmd) => {
    const workflow = buildWorkflowDocs(runCmd).find((doc) => doc.skillName === "swallowkit-add-model");
    expect(workflow).toBeDefined();
    expect(workflow?.skillDescription).toContain("including models with custom APIs");
    expect(workflow?.content).toContain(`${runCmd} swallowkit machine plan model <name> --overwrite never`);
    expect(workflow?.content).toContain(`${runCmd} swallowkit machine apply model --plan <planId>`);
    expect(workflow?.content).toContain("If custom APIs replace CRUD, skip scaffold");
    expect(workflow?.content).toContain(`${runCmd} swallowkit machine plan model-infrastructure <name>`);
    expect(workflow?.content).toContain("without changing schema bytes or generating CRUD");
    expect(workflow?.content).toContain("--refresh-pending");
    expect(workflow?.content).toContain("infra/migrations/manifest.json");
    expect(workflow?.content).toContain(".swallowkit/artifacts.json");
    expect(workflow?.content).toContain("verify fails while required local container migrations are missing or stale");
  });

  it("covers the requested model-change, new-feature, BFF, and deployment scenarios", () => {
    const agentsMd = buildAgentsMd(representativeContext);
    const pathInstructions = buildPathSpecificInstructions(representativeContext);

    // Scenario A: existing Todo field change.
    expect(agentsMd).toContain("For an existing model change, the normal pattern is");
    expect(agentsMd).toContain("edit source-of-truth model");
    expect(agentsMd).toContain("inspect drift");
    expect(agentsMd).toContain("verify before final semantic review");

    // Scenario B: new Order behavior starts with discovery and the add-model capability.
    expect(agentsMd).toContain("requirements clarification");
    expect(agentsMd).toContain("machine inspect entities");
    expect(agentsMd).toContain("machine inspect routes");
    expect(agentsMd).toContain("Use the `swallowkit-add-model` Agent Skill when available");

    // Scenario C: generated BFF logic is redirected to the correct ownership zone.
    const bff = pathInstructions[AGENT_TEMPLATE_FILES.bffRoutesInstructions];
    const functions = pathInstructions[AGENT_TEMPLATE_FILES.azureFunctionsInstructions];
    expect(bff).toContain("Never place business logic, database access");
    expect(bff).toContain("Never directly edit a route reported as deterministic");
    expect(functions).toContain("Put custom behavior only in an ai-authored location");

    // Scenario D: a broad deployment request never implies provisioning approval.
    expect(agentsMd).toContain("A broad request to deploy does not itself grant the explicit");
    expect(agentsMd).toContain("Use the `swallowkit-provision` Agent Skill or runbook");
    expect(agentsMd).toContain("When the status is `requires-human`, stop");
  });
});

describe("coding-agent documentation synchronization", () => {
  const englishGuidePath = path.join(repositoryRoot, "docs", "en", "coding-agent-guide.md");
  const japaneseGuidePath = path.join(repositoryRoot, "docs", "ja", "coding-agent-guide.md");

  it("publishes each complete English original directly from its canonical template", () => {
    const englishGuide = fs.readFileSync(englishGuidePath, "utf-8");
    const japaneseGuide = fs.readFileSync(japaneseGuidePath, "utf-8");

    const expectedIncludes = [
      "AGENTS.md",
      "CLAUDE.md",
      "copilot-instructions.md",
    ];
    for (const fileName of expectedIncludes) {
      const include = `<<< ../../src/core/project/agent-templates/${fileName}{md}`;
      expect(englishGuide).toContain(include);
      expect(japaneseGuide).toContain(include);
      expect(readAgentInstructionTemplate(fileName).length).toBeGreaterThan(500);
    }

    expect(englishGuide).toContain("complete English templates");
    expect(englishGuide).toMatch(/not\r?\nabridged excerpts/);
    expect(japaneseGuide).toContain("抜粋ではありません");
  });

  it("keeps the Japanese AGENTS.md translation aligned by canonical section", () => {
    const source = readAgentInstructionTemplate(AGENT_TEMPLATE_FILES.agentsMd);
    const translation = fs.readFileSync(
      path.join(repositoryRoot, "docs", "ja", "generated-agent-docs", "AGENTS.ja.md"),
      "utf-8"
    );
    const sourceSections = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    const translatedSourceSections = [
      ...translation.matchAll(/^<!-- source-section: (.+) -->$/gm),
    ].map((match) => match[1]);

    expect(translatedSourceSections).toEqual(sourceSections);
    expect(translation).toContain("カスタム API の有無にかかわらず");
    expect(translation).toContain("手書きモデルを追加しただけでは完了ではありません");
    expect(translation).toContain("{{runCmd}} swallowkit machine plan model <model> --overwrite never");
    expect(translation).toContain("{{runCmd}} swallowkit machine plan model-infrastructure <model>");
    expect(translation).toContain("{{runCmd}} swallowkit machine apply model --plan <planId>");
    expect(translation).toContain("不要な CRUD を scaffold してはなりません");
    expect(translation).toContain("理由と未完了");
    expect(translation).toContain("デプロイ可能と案内したりしてはなりません");
    for (const rule of [
      "dev-seeds/<environment>/learning-profile.json",
      "再 seed せずにアプリを再起動",
      "`AzureWebJobsStorage`",
      "TLS 検証を無効化",
      "worktree 分離後の DB 名",
      "ドキュメントだけの変更には実 DB の検証は不要",
      "File / JSON / SQLite / InMemory",
    ]) {
      expect(translation).toContain(rule);
    }
    for (const record of ["infra/migrations/manifest.json", ".swallowkit/artifacts.json", "sourceModel"]) {
      expect(translation).toContain(record);
    }
  });

  it("documents reviewed manual updates and avoids stale CLI-reference copies", () => {
    const englishGuide = fs.readFileSync(englishGuidePath, "utf-8").replace(/\s+/g, " ");
    const japaneseGuide = fs.readFileSync(japaneseGuidePath, "utf-8");
    expect(englishGuide).toContain("There is no instruction-update command");
    expect(englishGuide).toContain("manually merge the diff");
    expect(englishGuide).toContain("do not overwrite existing consumer documents");
    expect(japaneseGuide).toContain("指示ファイル専用の更新コマンドはありません");
    expect(japaneseGuide).toContain("手動でマージ");
    for (const language of ["en", "ja"]) {
      const reference = fs.readFileSync(path.join(repositoryRoot, "docs", language, "cli-reference.md"), "utf-8");
      expect(reference).toContain("./coding-agent-guide.md");
      expect(reference).not.toContain("# AGENTS.md\n");
      expect(reference).not.toContain("# CLAUDE.md\n");
    }
  });

  it("exposes matching major EN/JA guide topics and both sidebar entries", () => {
    const englishGuide = fs.readFileSync(englishGuidePath, "utf-8");
    const japaneseGuide = fs.readFileSync(japaneseGuidePath, "utf-8");
    const vitepressConfig = fs.readFileSync(
      path.join(repositoryRoot, "docs", ".vitepress", "config.mts"),
      "utf-8"
    );

    for (const topic of [
      "Generated agent integration files",
      "SwallowKit across the development lifecycle",
      "Inspect before asking or designing",
      "Responsibility boundary",
      "Planning and ticketing",
      "Implementation workflow",
      "Verification versus semantic review",
      "Human approval",
      "Composing with external development processes",
    ]) {
      expect(englishGuide.toLowerCase()).toContain(topic.toLowerCase());
    }
    for (const topic of [
      "生成される Agent integration files",
      "開発ライフサイクル全体での SwallowKit",
      "質問・設計の前に inspect する",
      "Responsibility boundary",
      "Planning と ticketing",
      "Implementation workflow",
      "Verification と semantic review の違い",
      "Human approval",
      "外部 development process との composition",
    ]) {
      expect(japaneseGuide).toContain(topic);
    }
    expect(vitepressConfig).toContain("/en/coding-agent-guide");
    expect(vitepressConfig).toContain("/ja/coding-agent-guide");
  });
});
