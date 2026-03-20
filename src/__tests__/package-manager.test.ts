import {
  getCommands,
  getWorkspaceConfig,
  getCiSetupStep,
  getAzurePipelinesSetup,
  getBuildScript,
  getFunctionsPrestart,
  getFunctionsStartScript,
  spawnArgs,
} from "../utils/package-manager";

describe("getCommands", () => {
  describe("pnpm", () => {
    const cmds = getCommands("pnpm");

    it("returns correct name", () => {
      expect(cmds.name).toBe("pnpm");
    });

    it("returns correct install command", () => {
      expect(cmds.install).toBe("pnpm install");
    });

    it("returns correct ci command", () => {
      expect(cmds.ci).toBe("pnpm install --frozen-lockfile");
    });

    it("returns correct add command", () => {
      expect(cmds.add).toBe("pnpm add");
    });

    it("returns correct addDev command", () => {
      expect(cmds.addDev).toBe("pnpm add -D");
    });

    it("returns correct exec command", () => {
      expect(cmds.exec).toBe("pnpm exec");
    });

    it("returns correct dlx command", () => {
      expect(cmds.dlx).toBe("pnpm dlx");
    });

    it("returns correct runFilter for workspace", () => {
      expect(cmds.runFilter("shared")).toBe("pnpm run --filter shared");
    });

    it("returns --use-pnpm flag for create-next-app", () => {
      expect(cmds.createNextAppFlag).toBe("--use-pnpm");
    });
  });

  describe("npm", () => {
    const cmds = getCommands("npm");

    it("returns correct name", () => {
      expect(cmds.name).toBe("npm");
    });

    it("returns correct install command", () => {
      expect(cmds.install).toBe("npm install");
    });

    it("returns correct ci command", () => {
      expect(cmds.ci).toBe("npm ci");
    });

    it("returns correct add command", () => {
      expect(cmds.add).toBe("npm install");
    });

    it("returns correct addDev command", () => {
      expect(cmds.addDev).toBe("npm install -D");
    });

    it("returns correct exec command", () => {
      expect(cmds.exec).toBe("npx");
    });

    it("returns correct dlx command", () => {
      expect(cmds.dlx).toBe("npx");
    });

    it("returns correct runFilter for workspace", () => {
      expect(cmds.runFilter("shared")).toBe("npm run --workspace=shared");
    });

    it("returns null for create-next-app flag", () => {
      expect(cmds.createNextAppFlag).toBeNull();
    });
  });
});

describe("getWorkspaceConfig", () => {
  it("returns pnpm-workspace.yaml config for pnpm", () => {
    const config = getWorkspaceConfig("pnpm", ["packages/*", "apps/*"]);
    expect(config.type).toBe("file");
    if (config.type === "file") {
      expect(config.filename).toBe("pnpm-workspace.yaml");
      expect(config.content).toContain("packages:");
      expect(config.content).toContain("  - packages/*");
      expect(config.content).toContain("  - apps/*");
    }
  });

  it("returns packageJson config for npm", () => {
    const config = getWorkspaceConfig("npm", ["packages/*", "apps/*"]);
    expect(config.type).toBe("packageJson");
    if (config.type === "packageJson") {
      expect(config.field).toBe("workspaces");
      expect(config.value).toEqual(["packages/*", "apps/*"]);
    }
  });
});

describe("getCiSetupStep", () => {
  it("returns pnpm setup step for pnpm", () => {
    const step = getCiSetupStep("pnpm");
    expect(step).toContain("pnpm/action-setup");
  });

  it("returns empty string for npm", () => {
    expect(getCiSetupStep("npm")).toBe("");
  });
});

describe("getAzurePipelinesSetup", () => {
  it("returns corepack step for pnpm", () => {
    const step = getAzurePipelinesSetup("pnpm");
    expect(step).toContain("corepack enable");
    expect(step).toContain("pnpm");
  });

  it("returns empty string for npm", () => {
    expect(getAzurePipelinesSetup("npm")).toBe("");
  });
});

describe("getBuildScript", () => {
  it("uses pnpm run --filter for pnpm", () => {
    expect(getBuildScript("pnpm")).toContain("pnpm run --filter shared build");
  });

  it("uses npm run --workspace for npm", () => {
    expect(getBuildScript("npm")).toContain("npm run --workspace=shared build");
  });
});

describe("getFunctionsPrestart", () => {
  it("uses pnpm run build for pnpm", () => {
    expect(getFunctionsPrestart("pnpm")).toBe("pnpm run build");
  });

  it("uses npm run build for npm", () => {
    expect(getFunctionsPrestart("npm")).toBe("npm run build");
  });
});

describe("getFunctionsStartScript", () => {
  it("uses pnpm start for pnpm", () => {
    expect(getFunctionsStartScript("pnpm")).toContain("pnpm start");
  });

  it("uses npm start for npm", () => {
    expect(getFunctionsStartScript("npm")).toContain("npm start");
  });
});

describe("spawnArgs", () => {
  it("returns cmd and args for pnpm", () => {
    const result = spawnArgs("pnpm", ["add", "next@latest"]);
    expect(result).toEqual({ cmd: "pnpm", args: ["add", "next@latest"] });
  });

  it("returns cmd and args for npm", () => {
    const result = spawnArgs("npm", ["install", "next@latest"]);
    expect(result).toEqual({ cmd: "npm", args: ["install", "next@latest"] });
  });
});
