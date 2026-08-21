/**
 * Infra Inspection — infra/ 配下の Bicep 資産を決定論的に解析する。
 * az CLI やネットワークアクセスは一切使わない(純粋なテキスト解析)。
 */

import * as fs from "fs";
import * as path from "path";

export interface InfraParam {
  name: string;
  type: string;
  defaultValue?: string;
  description?: string;
  allowed?: string[];
}

export interface InfraModule {
  symbolicName: string;
  source: string;
  deploymentName?: string;
  condition?: string;
}

export interface InfraOutput {
  name: string;
  type: string;
}

export interface InfraContainer {
  file: string;
  /** main.bicep に module として配線済みか */
  wired: boolean;
}

export interface InfraInspection {
  hasInfraDirectory: boolean;
  mainBicep: {
    exists: boolean;
    path: string;
    params: InfraParam[];
    modules: InfraModule[];
    outputs: InfraOutput[];
  };
  parametersFile: {
    exists: boolean;
    path: string;
  };
  moduleFiles: string[];
  containers: InfraContainer[];
  boundary: {
    zone: "shared";
    note: string;
  };
  warnings: string[];
}

function parseParams(content: string): InfraParam[] {
  const params: InfraParam[] = [];
  const lines = content.split(/\r?\n/);
  let pendingDescription: string | undefined;
  let pendingAllowed: string[] | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const descMatch = /^@description\('([^']*)'\)/.exec(line);
    if (descMatch) {
      pendingDescription = descMatch[1];
      continue;
    }

    if (/^@allowed\(/.test(line)) {
      // 単一行 @allowed(['a', 'b']) と複数行の両方に対応
      let block = line;
      let j = i;
      while (!block.includes(")") && j + 1 < lines.length) {
        j++;
        block += "\n" + lines[j].trim();
      }
      i = j;
      pendingAllowed = Array.from(block.matchAll(/'([^']*)'/g)).map((m) => m[1]);
      continue;
    }

    const paramMatch = /^param\s+(\w+)\s+(\w+)(?:\s*=\s*(.+))?$/.exec(line);
    if (paramMatch) {
      params.push({
        name: paramMatch[1],
        type: paramMatch[2],
        ...(paramMatch[3] ? { defaultValue: paramMatch[3].trim() } : {}),
        ...(pendingDescription ? { description: pendingDescription } : {}),
        ...(pendingAllowed ? { allowed: pendingAllowed } : {}),
      });
      pendingDescription = undefined;
      pendingAllowed = undefined;
      continue;
    }

    if (line !== "" && !line.startsWith("@") && !line.startsWith("//")) {
      pendingDescription = undefined;
      pendingAllowed = undefined;
    }
  }

  return params;
}

function parseModules(content: string): InfraModule[] {
  const modules: InfraModule[] = [];
  const moduleRegex = /module\s+(\w+)\s+'([^']+)'\s*=\s*(?:if\s*\(([^)]*)\)\s*)?\{/g;
  for (const match of content.matchAll(moduleRegex)) {
    const rest = content.slice((match.index ?? 0) + match[0].length);
    const nameMatch = /name:\s*'([^']*)'/.exec(rest.slice(0, 200));
    modules.push({
      symbolicName: match[1],
      source: match[2],
      ...(nameMatch ? { deploymentName: nameMatch[1] } : {}),
      ...(match[3] ? { condition: match[3].trim() } : {}),
    });
  }
  return modules;
}

function parseOutputs(content: string): InfraOutput[] {
  const outputs: InfraOutput[] = [];
  for (const match of content.matchAll(/^output\s+(\w+)\s+(\w+)\s*=/gm)) {
    outputs.push({ name: match[1], type: match[2] });
  }
  return outputs;
}

function listBicepFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".bicep"))
    .sort();
}

export function inspectInfra(projectRoot: string = process.cwd()): InfraInspection {
  const infraDir = path.join(projectRoot, "infra");
  const mainBicepPath = path.join(infraDir, "main.bicep");
  const parametersPath = path.join(infraDir, "main.parameters.json");
  const warnings: string[] = [];

  const hasInfraDirectory = fs.existsSync(infraDir);
  const mainExists = fs.existsSync(mainBicepPath);

  let params: InfraParam[] = [];
  let modules: InfraModule[] = [];
  let outputs: InfraOutput[] = [];
  let mainContent = "";

  if (mainExists) {
    mainContent = fs.readFileSync(mainBicepPath, "utf-8");
    params = parseParams(mainContent);
    modules = parseModules(mainContent);
    outputs = parseOutputs(mainContent);
  } else if (hasInfraDirectory) {
    warnings.push("infra/main.bicep not found; provisioning is not possible until it is restored.");
  }

  const moduleFiles = listBicepFiles(path.join(infraDir, "modules")).map((f) => `infra/modules/${f}`);

  const containers: InfraContainer[] = listBicepFiles(path.join(infraDir, "containers")).map((f) => {
    const wired = mainContent.includes(`containers/${f}`);
    if (!wired) {
      warnings.push(
        `container-not-wired: infra/containers/${f} is not referenced from infra/main.bicep; run scaffold again or wire it manually.`
      );
    }
    return { file: `infra/containers/${f}`, wired };
  });

  return {
    hasInfraDirectory,
    mainBicep: {
      exists: mainExists,
      path: "infra/main.bicep",
      params,
      modules,
      outputs,
    },
    parametersFile: {
      exists: fs.existsSync(parametersPath),
      path: "infra/main.parameters.json",
    },
    moduleFiles,
    containers,
    boundary: {
      zone: "shared",
      note: "infra/main.bicep is an extension point: scaffold appends container modules deterministically; humans may edit other sections. infra/containers/*.bicep are managed (regenerated by scaffold).",
    },
    warnings,
  };
}
