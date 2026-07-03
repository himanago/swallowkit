import * as fs from "fs";
import * as path from "path";

export function getSwallowKitVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "..", "package.json");

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return packageJson.version || "0.0.0";
  } catch {
    return process.env.npm_package_version || "0.0.0";
  }
}
