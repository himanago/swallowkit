/**
 * SwallowKit Add-Connector コマンド
 * swallowkit.config.js にコネクタ設定を追加する
 */

import * as fs from "fs";
import * as path from "path";
import { ensureSwallowKitProject } from "../../core/config";
import { ConnectorDefinition } from "../../types";

interface AddConnectorOptions {
  name: string;
  type: "rdb" | "api";
  provider?: "mysql" | "postgres" | "sqlserver";
}

/**
 * add-connector コマンド
 */
export async function addConnectorCommand(options: AddConnectorOptions) {
  ensureSwallowKitProject("add-connector");

  console.log(`🔌 SwallowKit Add-Connector: Adding '${options.name}' connector...\n`);

  const configPath = findConfigFile();
  if (!configPath) {
    console.error("❌ swallowkit.config.js not found. Run 'swallowkit init' first.");
    process.exit(1);
  }

  // Build connector definition
  const connectorDef = buildConnectorDefinition(options);

  // Update config file
  updateConfigWithConnector(configPath, options.name, connectorDef, options);

  console.log(`\n✅ Connector '${options.name}' added successfully!`);
  console.log("\n📝 Next steps:");
  console.log(`  1. Review the connector settings in ${configPath}`);
  console.log(`  2. Set the required environment variables in functions/local.settings.json`);
  console.log(`  3. Create models with: npx swallowkit create-model <name> --connector=${options.name}`);
}

function findConfigFile(): string | null {
  const candidates = ["swallowkit.config.js", "swallowkit.config.json", ".swallowkitrc.json"];
  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function buildConnectorDefinition(options: AddConnectorOptions): ConnectorDefinition {
  const name = options.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  if (options.type === "rdb") {
    return {
      type: "rdb",
      provider: options.provider || "mysql",
      connectionEnvVar: `${name}_CONNECTION_STRING`,
    };
  }

  return {
    type: "api",
    baseUrlEnvVar: `${name}_API_BASE_URL`,
    auth: {
      type: "apiKey",
      envVar: `${name}_API_KEY`,
      placement: "query",
      paramName: "apiKey",
    },
  };
}

/**
 * swallowkit.config.js にコネクタ設定を追加
 */
export function updateConfigWithConnector(
  configPath: string,
  connectorName: string,
  connectorDef: ConnectorDefinition,
  options: AddConnectorOptions
): void {
  const content = fs.readFileSync(configPath, "utf-8");

  if (configPath.endsWith(".json")) {
    // JSON config
    const config = JSON.parse(content);
    if (!config.connectors) {
      config.connectors = {};
    }
    config.connectors[connectorName] = connectorDef;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log(`✅ Updated: ${configPath}`);
    return;
  }

  // JS config — append connectors section
  if (content.includes("connectors:") || content.includes("connectors :")) {
    console.log(`⚠️  'connectors' section already exists in ${configPath}. Please add the connector manually:`);
    console.log(formatConnectorSnippet(connectorName, connectorDef, options));
    return;
  }

  // Find the last property before the closing of module.exports
  const closingBraceIdx = content.lastIndexOf("}");
  if (closingBraceIdx === -1) {
    console.error("❌ Could not parse config file structure. Please add the connector manually:");
    console.log(formatConnectorSnippet(connectorName, connectorDef, options));
    return;
  }

  // Check if we need a comma before inserting
  const beforeClosing = content.substring(0, closingBraceIdx).trimEnd();
  const needsComma = !beforeClosing.endsWith(",") && !beforeClosing.endsWith("{");

  const connectorBlock = generateConnectorJSBlock(connectorName, connectorDef, options);
  const insertion = `${needsComma ? "," : ""}\n  // コネクタ定義\n  connectors: {\n${connectorBlock}\n  },\n`;

  const newContent = content.substring(0, closingBraceIdx) + insertion + content.substring(closingBraceIdx);
  fs.writeFileSync(configPath, newContent, "utf-8");
  console.log(`✅ Updated: ${configPath}`);
}

function generateConnectorJSBlock(name: string, def: ConnectorDefinition, options: AddConnectorOptions): string {
  if (def.type === "rdb") {
    return `    ${name}: {
      type: 'rdb',
      provider: '${(def as any).provider}',
      connectionEnvVar: '${def.connectionEnvVar}',
    },`;
  }

  const apiDef = def as any;
  let authBlock = "";
  if (apiDef.auth) {
    authBlock = `
      auth: {
        type: '${apiDef.auth.type}',
        envVar: '${apiDef.auth.envVar}',
        placement: '${apiDef.auth.placement || "query"}',
        paramName: '${apiDef.auth.paramName || "apiKey"}',
      },`;
  }

  return `    ${name}: {
      type: 'api',
      baseUrlEnvVar: '${apiDef.baseUrlEnvVar}',${authBlock}
    },`;
}

function formatConnectorSnippet(name: string, def: ConnectorDefinition, options: AddConnectorOptions): string {
  return `\n  ${name}: ${JSON.stringify(def, null, 4)}\n`;
}
