const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..", "..", "..");
require.extensions[".ts"] = (module, file) => {
  module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  }).outputText, file);
};
const azure = require(path.join(root, "src", "utils", "azure-cli.ts"));
azure.setAzCliInvocationForTesting({
  command: process.execPath,
  prefixArgs: [path.join(__dirname, "azure-cli.cjs")],
  source: "isolated fixture",
});
const provision = require(path.join(root, "src", "core", "operations", "provision-operations.ts"));
const state = JSON.parse(fs.readFileSync(process.env.SWALLOWKIT_AZ_FIXTURE_STATE, "utf8"));
void (async () => {
  const plan = await provision.planProvisionOperation({
    resourceGroup: state.resourceGroup, location: "japaneast", swaLocation: "eastasia",
  });
  const result = await provision.executeProvisionPlan(plan, { approve: true });
  console.log(JSON.stringify(result));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
