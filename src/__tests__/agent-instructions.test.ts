import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
    expect(pnpmDocument).toContain("pnpm swallowkit machine ...");
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-agent-docs-"));
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
    expect(englishGuide).toContain("not\nabridged excerpts");
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
