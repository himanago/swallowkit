const fs = require("node:fs");
const args = process.argv.slice(2);
const emit = (value) => process.stdout.write(JSON.stringify(value));

if (args[0] === "process") {
  const mode = args[1];
  if (mode === "warning" || mode === "slow") {
    console.error("WARNING: fixture Bicep warning");
    if (mode === "slow") setTimeout(() => emit({ done: true }), Number(args[2] ?? 600));
  } else if (mode === "flood") {
    process.stdout.write("x".repeat(2 * 1024 * 1024));
    process.stderr.write("y".repeat(2 * 1024 * 1024));
  } else if (mode === "communication") {
    console.error("ConnectionResetError: fixture communication interrupted");
    process.exitCode = 1;
  } else if (mode === "nonzero") {
    console.error("ERROR: fixture az failure");
    process.exitCode = 7;
  } else if (mode === "echo") {
    emit(args.slice(2));
  } else if (mode === "terminate") {
    process.kill(process.pid, "SIGTERM");
  }
  return;
}

const file = process.env.SWALLOWKIT_AZ_FIXTURE_STATE;
if (!file) throw new Error("This fixture requires its isolated state file; it never invokes Azure.");
const state = JSON.parse(fs.readFileSync(file, "utf8"));
state.calls.push(args);
const save = () => {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, file);
};
const value = (flag) => args[args.indexOf(flag) + 1];
const subscription = state.subscription;
const resourceGroup = state.resourceGroup;
const groupId = `/subscriptions/${subscription}/resourceGroups/${resourceGroup}`;
save();

if (args[0] === "--version") {
  process.stdout.write("azure-cli fixture");
} else if (args[0] === "account" && args[1] === "show") {
  process.stdout.write(subscription);
} else if (args[0] === "bicep" && args[1] === "build") {
  emit(state.template);
} else if (args[0] === "group" && args[1] === "exists") {
  process.stdout.write(String(state.groupExists));
} else if (args[0] === "group" && args[1] === "show") {
  emit({ id: groupId, tags: state.tags });
} else if (args[0] === "group" && args[1] === "create") {
  state.groupExists = true;
  state.groupCreates++;
  save();
  emit(groupId);
} else if ((args[0] === "tag" && args[1] === "update") || (args[0] === "group" && args[1] === "update")) {
  state.tagAttempts++;
  const assignment = value(args[0] === "tag" ? "--tags" : "--set").replace(/^tags\./, "");
  const index = assignment.indexOf("=");
  const apply = () => { state.tags[assignment.slice(0, index)] = assignment.slice(index + 1); };
  if (state.failTags > 0) {
    state.failTags--;
    if (state.applyTagBeforeFailure) apply();
    save();
    console.error("ERROR: fixture tag update failed");
    process.exitCode = 9;
  } else {
    apply();
    save();
  }
} else if (args[0] === "deployment" && args[1] === "operation") {
  emit(state.operations ?? []);
} else if (args[0] === "deployment" && args[2] === "export") {
  emit(state.remoteTemplate ?? state.template);
} else if (args[0] === "deployment" && args[2] === "what-if") {
  emit({ changes: [] });
} else if (args[0] === "deployment" && args[2] === "create") {
  const name = value("--name");
  state.deploymentCreates++;
  state.deployments[name] = {
    correlationId: `fixture-correlation-${state.deploymentCreates}`,
    templateHash: "fixture-template-hash",
  };
  save();
  if (state.warning) console.error("WARNING: The configuration value of bicep.use_binary_from_path has been set to 'false'.");
  if (state.submitStderr) console.error(state.submitStderr);
  if (state.submitMode === "communication") {
    console.error("ConnectionResetError: fixture connection closed after acceptance");
    process.exitCode = 1;
  } else if (state.submitMode === "nonzero") {
    console.error("ERROR: fixture submit exited nonzero");
    process.exitCode = 7;
  } else if (state.submitMode === "flood") {
    process.stdout.write(JSON.stringify({ properties: { outputs: { apiKey: { value: "fixture-secret-do-not-print" } } } }));
    process.stdout.write("x".repeat(2 * 1024 * 1024));
    process.stderr.write("y".repeat(2 * 1024 * 1024));
  } else if (state.submitMode === "slow") {
    setTimeout(() => emit({ accepted: true }), state.submitDelay ?? 2000);
  } else {
    emit({ accepted: true });
  }
} else if (args[0] === "deployment" && args[2] === "show") {
  const name = value("--name");
  const deployment = state.deployments[name];
  if (!deployment || state.queryMode === "not-found") {
    console.error("ERROR: (DeploymentNotFound) fixture deployment is not visible");
    process.exitCode = 3;
  } else if (state.queryMode === "communication") {
    console.error("ConnectionResetError: fixture status query interrupted");
    process.exitCode = 1;
  } else if (state.queryMode === "invalid") {
    process.stdout.write("{invalid JSON");
  } else if (value("--query") === "properties.parameters") {
    emit(state.parameters);
  } else {
    const states = state.states ?? ["Succeeded"];
    const provisioningState = states.length > 1 ? states.shift() : states[0];
    save();
    emit({
      id: `${groupId}/providers/Microsoft.Resources/deployments/${name}`,
      name, state: provisioningState,
      correlationId: deployment.correlationId, templateHash: deployment.templateHash,
      error: state.error ?? null,
    });
  }
} else {
  console.error("ERROR: fixture does not support this command");
  process.exitCode = 4;
}
