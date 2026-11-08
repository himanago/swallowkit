# Deploy to Azure

**React:** generated workflows deploy prebuilt `dist/` and `bff/` to SWA with
`skip_app_build` and `skip_api_build`. Deploy standalone `functions/` separately;
never link it to SWA or use it as `api_location`.
See [React deployment](./react-guide.md#build-verify-deploy) before using the
Next.js/Oryx examples below.

Next.js projects explicitly set `cacheComponents: false` in `next.config.ts`.
Generated pages use dynamic route settings, which are incompatible with Cache
Components. Init also disables `partialPrefetching` when present because it depends
on Cache Components. Preserve these settings when upgrading an existing project.

See [package manager commands and troubleshooting](./package-managers.md) for pnpm 11/12 and npm usage.

Provision Azure resources and configure CI/CD for a SwallowKit project. After completing this guide, your application will be running on Azure Static Web Apps with an Azure Functions backend and Cosmos DB.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Generated Resources](#generated-resources)
- [CI/CD Workflows](#ci-cd-workflows)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Azure account
- Azure CLI (`az`) installed and signed in (`az login`). `az --version` must work in the terminal that runs SwallowKit. On Windows, the `az.cmd` wrapper from the MSI/winget installer is supported.
- GitHub account (for GitHub Actions)
- Azure DevOps account (for Azure Pipelines)

## Quick Start

### 1. Initialize Project

```bash
npx swallowkit@beta init my-app
cd my-app
```

Choose CI/CD provider during initialization:
- GitHub Actions
- Azure Pipelines

### 2. Provision Azure Resources

```bash
npx swallowkit provision --resource-group my-app-rg \
  --location japaneast --swa-location eastasia
```

If regions are omitted, the command prompts for them. Running normal `provision` requests deployment; there is no additional command-approval prompt or machine plan/apply procedure. It reads Azure state, deploys `infra/main.bicep` on first use, and records migration baseline 0. After success it displays resource names/URLs and the three CI/CD values: `AZURE_STATIC_WEB_APPS_API_TOKEN` (SWA deployment token), `AZURE_FUNCTIONAPP_NAME`, and `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` (publish profile XML). These secrets are shown only in the terminal and are not saved by SwallowKit; if a value cannot be retrieved, the exact `az` command to get it is printed instead and provisioning is still treated as successful. Execution checkpoints and migration tracking remain internal safeguards against replaying interrupted deployments or resetting existing app settings. Machine/MCP is a separate agent interface and still requires a saved plan and explicit human approval.

This creates using Bicep templates:
- Azure Static Web Apps
- Azure Functions (Flex Consumption)
- Azure Cosmos DB (the Free Tier or Serverless option selected during initialization)
- Managed Identity (secure service connections)

If `az` cannot be found or started, the command exits without asking for confirmation, and nothing is changed in Azure. A `az-cli-not-found` warning means `az` is not on PATH, and `az-cli-not-runnable` means it was found but failed to start. If you are not signed in, the command asks you to run `az login`. Fix the cause and run `provision` again.

In non-interactive environments, pass `--location` and `--swa-location`. `--approve` is retained only for compatibility; normal provision does not require it. Obtain CI/CD secrets with the Azure CLI commands later in this guide.

#### Interrupted waiting and partial completion

Bicep is submitted once with `--no-wait`. Normal `provision` (and `provision --resume`) then keeps polling the original deployment until Azure reaches `Succeeded`, `Failed`, or `Canceled`; there is no overall time limit, so a 10-20 minute deployment completes in one run and then prints resource information and CI/CD settings. Individual az calls are bounded, and brief state-read errors are retried. Machine/MCP apply keeps a bounded wait (default 300 seconds, `--wait-seconds` 0-3600) so agents get a prompt response. Warning-only stderr with exit 0 is not failure, and excess output is drained/discarded instead of killing az. Diagnostics distinguish exit code, signal, timeout/communication errors and Azure state, with bounded/redacted output and an omission flag. Machine/MCP does not return deployment outputs. After success, normal CLI reads only the named resource-information outputs (never arbitrary outputs) and retrieves the SWA deployment token and Functions publish profile with `az` to print them to the terminal only.

If waiting stops early (Ctrl+C, or Azure state stays unreadable), Azure `Running`/`Accepted` is reported as in progress, not `provision-failed`. An unreadable or not-found deployment returns `unknown` (`blocked`); it is not evidence of Azure failure. Azure `Failed`/`Canceled` reports its sanitized error and failed operation causes. Azure `Succeeded` is only **partial** until the migration tag and local ledger finish.

Keep `.swallowkit/state/provision/` and use the displayed run ID (the original plan ID):

```powershell
pnpm exec swallowkit provision --status <runId>
# Continue the original run and wait until it finishes:
pnpm exec swallowkit provision --resume <runId>
```

Status is read-only. Resume rechecks the original subscription, deployment ID/correlation, fingerprints and migration checksums. It never re-submits an attempted deployment; it can finish unattempted reviewed steps and tag/ledger bookkeeping. If tag/ledger writes failed after Azure Succeeded, resume that checkpoint rather than redeploying the baseline. Ctrl+C or hard termination may leave Azure running; SwallowKit never cancels/deletes it automatically. A forcibly killed process cannot print a final result, but its pre-write checkpoint supports recovery.

Cancelling an MCP provision request also stops its local machine child/wait, not the Azure deployment. Inspect the original plan/run ID before resuming; a cancelled or missing MCP response is not evidence of Azure failure.

#### Recover an older untracked baseline

For an interrupted bootstrap from a version without execution checkpoints, first read the original deployment; do not run a new bootstrap or `--reconcile` merely to fix tagging:

```powershell
az deployment group show --resource-group <original-rg> --name swallowkit-baseline --subscription <original-subscription> --query "{state:properties.provisioningState,error:properties.error}" -o json
pnpm exec swallowkit provision -g <original-rg> --subscription <original-subscription> --location japaneast --swa-location eastasia --resume-deployment swallowkit-baseline
```

With a CLI containing this recovery option, the second command compares the existing deployment's exported ARM template and non-secure parameters to the original local Bicep/parameter files, then only observes and completes bookkeeping. It never sends a deployment create. Running deployments are tracked; after Succeeded it finishes tags/ledger. Template/parameter mismatches, unreadable evidence, secure parameters, legacy manifests, or non-baseline migration recovery block rather than guessing. Restore matching reviewed files; do not replace the manifest or weaken checks. Inspect error messages locally and redact secrets before sharing them.

An Azure terminal `Failed` result is different from an interrupted local wait. For a failed Cosmos module, inspect that module's deployment operations in Azure Portal. `NotFound: Request url is invalid` alone does not identify the cause. Cosmos DB account and Function App names are globally unique across Azure. Projects initialized with this version generate `cosmos-<projectName>-<suffix>` and `func-<projectName>-<suffix>`, where the suffix is derived from the resource group, so each resource group gets its own names and redeploying to the same resource group keeps them. Projects initialized with earlier versions use `cosmos-<projectName>` and `func-<projectName>` in `infra/main.bicep`; changing only the resource group does not change those names, and Azure can keep a name reserved for a while after its account or resource group is deleted (for example, `database account ... state is not Online`). Check existing account names before another deployment; do not delete or rename deployed accounts just to retry. See [Azure naming rules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftdocumentdb).

### 3. Push Code

Push your code to trigger the CI/CD workflow:

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

> **Note**: This push will automatically trigger the CI/CD workflow, but it will **fail** because secrets are not registered yet. This is expected — proceed to the next step.

### 4. Cancel, Register Secrets, and Re-run

#### Step 4-1: Cancel the auto-triggered CI/CD run

The initial push triggers a CI/CD run that cannot succeed without secrets. Cancel it:

- **GitHub Actions**: Go to the Actions tab → click the running workflow → Cancel workflow
- **Azure Pipelines**: Go to Pipelines → click the running pipeline → Cancel

#### Step 4-2: Register secrets / variables

Use the values printed by `swallowkit provision` under "CI/CD settings". If a value could not be retrieved automatically, run the `az` command printed next to it.

##### For GitHub Actions

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets:
  - `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - `AZURE_FUNCTIONAPP_NAME`
  - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

##### For Azure Pipelines

1. Azure DevOps → Pipelines → Library → Variable groups
2. Create group named `azure-deployment`
3. Add the following variables:
  - `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - `AZURE_FUNCTIONAPP_NAME`
  - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

#### Step 4-3: Manually re-run the CI/CD workflow

- **GitHub Actions**: Actions tab → select the failed workflow → Re-run all jobs
- **Azure Pipelines**: Pipelines → select the failed pipeline → Run pipeline

### Optional Cosmos DB bootstrap seed (GitHub Actions; TypeScript, C#, and Python)

Use the reviewed JSON under `dev-seeds/<name>/` to initialize Azure Cosmos DB with the same data you tested locally. See [local development](./dev-guide.md#dev-seeds) for the flow from model definition and CRUD generation to seed capture and local testing. This section covers applying those seeds to Azure and deliberately correcting initial data when needed.

Generated TypeScript, C#, and Python projects include `.github/workflows/initialize-cosmos-seeds.yml`. This is a separate, manual workflow; normal push deployments do not seed data.

Keep one source of truth in the existing `dev-seeds/<name>/` directory. Generate a template with `npx swallowkit create-dev-seeds local`, or explicitly export the local Emulator with `npx swallowkit create-dev-seeds local --from-emulator`. Review and edit the JSON, then use `npx swallowkit dev --seed-env local` to test it locally. That local command replaces the selected Emulator containers. For Azure, choose the default or force write mode described below. Commit only the reviewed seed files you intend to use in Azure.

#### Before running

The database and **every container referenced by the seed must already exist in Azure**. After adding or scaffolding models, apply the pending infrastructure migrations with `swallowkit provision` against the intended resource group before initializing seeds. Neither normal bootstrap nor `force` creates databases or containers. Shared schema validation and a successful Functions deployment do not prove that the corresponding Azure containers exist.

```bash
# Use the existing application's resource group and subscription.
npx swallowkit provision --resource-group <existing-resource-group> \
  --subscription <existing-subscription> \
  --location <existing-location> --swa-location <existing-swa-location>
```

Confirm that provisioning succeeded, the target database contains the expected containers (names are case-sensitive), and the Functions app points to that account and database. Do not run `--reconcile`, delete resources, or create a different database merely to retry a seed run. A new provisioning operation can deploy resources and incur costs; use your project's normal infrastructure approval process.

#### Run and choose the write mode

From the repository's `main` branch, go to **Actions → Initialize Azure Cosmos DB seed data → Run workflow**, enter the exact directory name as `seed_name`, and confirm the Function App name configured in `AZURE_FUNCTIONAPP_NAME`. The workflow rejects non-`main` refs, invalid names, missing directories/files, unknown models, invalid Zod data, and seeds over 500 documents or 4 MiB. It validates with the built shared Zod schemas, fixes the selected data into a temporary TypeScript, C#, or Python Function at build time, then deploys it, calls it, and redeploys the saved ordinary Functions package. The endpoint does not accept a seed name, arbitrary JSON, or a container name.

| Input | Meaning |
|---|---|
| `seed_name` | Existing directory under `dev-seeds/`, for example `local` |
| `function_app_name` | Exact confirmation of `AZURE_FUNCTIONAPP_NAME` |
| `force` | Off by default; enable only to create or overwrite seed items without deleting other items |

The workflow uses the deployment action's `app-url` output instead of constructing a hostname from the app name; Flex Consumption hostnames can include a unique suffix and region. Before sending a single initialization POST, it polls the same endpoint with authenticated, read-only GET requests (up to 12 attempts, with a 10-second request timeout and 5 seconds between attempts). GET only checks the temporary Function's token and expiry; it does not access Cosmos DB. Readiness failures still trigger restoration. A persistent 404 requires checking the actual hostname, deployed Function registration, and startup logs. For older generated projects, update both the workflow and `.github/scripts/prepare-cosmos-bootstrap.mjs` together; a workflow with readiness polling requires the new GET handler.

By default, Azure bootstrap uses create-only semantics: new items are created, identical items are skipped (Cosmos system properties are ignored), and differing items cause a conflict. It never replaces or deletes existing items or containers. A failed run can have committed earlier items; review the reported counts and conflict before retrying. Re-running the same reviewed seed is safe for already-created identical items.

To explicitly overwrite seed items, select `force` when dispatching the workflow (default: `false`). Force uses upsert for each validated seed item: it creates a missing item or replaces the entire item with the same `id` and partition key, including removing properties absent from the seed. Items absent from the seed and containers are never deleted. Changing a partition key creates a separate item; it does not remove the old one. Force is fixed into the temporary package, not accepted from the HTTP request. The `upserted` count reports successful force writes (both creates and replacements); `created` and `skipped` remain zero in this mode. This is not an atomic reset: earlier writes remain if a later write fails. Review the seed and target before enabling force. Existing projects must update both the workflow and preparation script.

#### Results and troubleshooting

A successful POST returns counts such as `{"created":0,"upserted":44,"skipped":0,"conflicts":0,"failed":0}` for a force run. Confirm that the initialization step **and** the subsequent ordinary-package restoration both succeed. Restoration restores code, not database contents: it never rolls back successful seed writes.

| Result | Meaning and action |
|---|---|
| Readiness GET initially returns 404, then succeeds | The temporary route was still starting. No seed writes occur during GET polling. |
| Readiness never succeeds | Check the deployment URL, Function registration/startup, authentication expiry, and network access. No initialization POST was sent. |
| POST returns 409 / `data-conflict` | Default mode found different existing data. Inspect the reported seed position; correct the seed or deliberately select `force`. |
| POST returns 503 with C# `cosmosStatusCode: 404` | This is a Cosmos resource error, not the readiness 404. Verify the database/container and connection target. `404` / `1003` for `upsert-item` can indicate a missing container: provision the pending model migrations before retrying. |
| POST times out or returns `write-outcome-unknown` | Earlier writes remain; the failed write may also have committed. Inspect diagnostics and existing data before retrying. Do not interpret the wrapper 503 as proof of transient Cosmos unavailability. |
| Ordinary-package restoration fails | Redeploy the ordinary Functions package using the existing deployment workflow after correcting the deployment issue. |

For C# bootstrap failures, the response also includes the operation, container name, zero-based seed position, elapsed time, exception type, and (for Cosmos exceptions) status/substatus codes, activity ID, and retry delay. The HTTP 503 wrapper alone does not identify the underlying Cosmos error. These diagnostics omit exception messages, document values, and connection details. A positive `upserted` count means partial writes already occurred; inspect the diagnostic result before deciding whether to retry.

On a data conflict, the response includes `containerName` and `seedDocumentIndex` (zero-based position in the validated seed array). Use these to locate the seed item and compare its `id` and partition key with the existing Cosmos item. Document values are not included in the error. A 409 remains a failed initialization, not an indeterminate outcome or a successful skip. Keep existing data unchanged until the difference has been reviewed.

The temporary endpoint explicitly uses `authLevel: anonymous` and separately requires a cryptographically random UUID v4 in the `Authorization: Bearer` header. GitHub Actions masks the raw token; only its SHA-256 hash and expiry are embedded in the temporary package. The token expires after 15 minutes. This is a temporary bearer credential, **not verification of the GitHub user's identity**. The workflow continues to use `Azure/functions-action` and `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`; publish profiles have security limitations compared with OIDC. OIDC migration is not part of this feature and remains a future improvement. No Subscription or Resource Group lookup is performed. The workflow relies on the existing GitHub Actions dispatch permissions, branch protections, and secret access; protect `main` and restrict who can run deployments, especially for production.

The synchronous Function enforces a 180-second processing deadline and a 500-document / 4 MiB input cap, below the Azure Functions HTTP trigger's 230-second platform limit. If a call times out or returns an indeterminate write result, the workflow fails without claiming success and still attempts to restore the ordinary package. Create-only semantics make a reviewed retry safe, but check partial counts and conflicts first. Bootstrap and normal Functions deployments share a non-canceling concurrency group so they do not deploy concurrently.

Use this two-deployment workflow preferably for first initialization before the app is publicly released. Replacing a live Flex Consumption Function package can interrupt requests or affect in-flight work; assess downtime and workload impact before using it on a live app. Cosmos DB networking and firewall settings are never relaxed. If Cosmos is private-only, Functions must already be able to reach it through their existing VNet/Managed Identity configuration. A GitHub-hosted runner also needs to reach the Function App's HTTP endpoint; if the app is private-only, this workflow will fail rather than opening network access automatically.

If restoration fails, the workflow fails and prints a recovery error. Restore the ordinary Functions package by running **Deploy Azure Functions** from `main` after correcting the existing publish-profile issue. A timeout does not prove that no writes occurred; inspect partial results before retrying.

## Generated Resources

### Azure Static Web Apps

- **Purpose**: Host Next.js application
- **Mode**: Standalone (optimized bundle size)
- **Features**:
  - Global CDN
  - Automatic HTTPS
  - Custom domain support

### Azure Functions

- **Plan**: Flex Consumption
- **Runtime**: Selected during initialization (TypeScript/Node.js 22, C#/.NET Isolated 10.0, or Python 3.14). Local Python selection is independent; use the deployment version when checking cloud compatibility.
- **Features**:
  - HTTP triggers
  - Cosmos DB bindings
  - Zod schema validation

### Azure Cosmos DB

- **Mode**: The Free Tier or Serverless option selected during initialization
- **Features**:
  - Automatic scaling
  - Global distribution
  - RBAC access control

### Managed Identity

- **Type**: System-assigned managed identity
- **Purpose**: Secure service-to-service authentication without connection strings
- **Permissions**: Read/write access to Cosmos DB

## CI/CD Workflows

### Generated Files

```
.github/workflows/           # For GitHub Actions
├── static-web-app.yml       # SWA deployment
└── azure-functions.yml      # Functions deployment

pipelines/                   # For Azure Pipelines
├── static-web-app.yml
└── azure-functions.yml
```

### Workflow Behavior

**Static Web Apps Workflow:**
- Triggers: Push to `main`, changes in `app/**`, `components/**`, `lib/**`
- Steps:
  1. Build Next.js in standalone mode
  2. Deploy to Azure Static Web Apps
  3. Create preview environment (for PRs)

**Azure Functions Workflow:**
- Triggers: Push to `main`, changes in `functions/**`
- Steps:
  1. Install dependencies
  2. Build TypeScript
  3. Deploy to Azure Functions

### Path-Based Triggers

For efficient deployments, only relevant workflows run based on changed files:

- Frontend changes (`app/`, `components/`, `lib/`) → Deploy SWA only
- Backend changes (`functions/`) → Deploy Functions only
- Both changed → Deploy both

## Environment Variables

### Local Development (`.env.local`)

```bash
# Cosmos DB Emulator
COSMOS_DB_ENDPOINT=https://localhost:8081/
COSMOS_DB_KEY=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==

# Azure Functions (local)
BACKEND_API_URL=http://localhost:7071
```

### Production (Azure)

```bash
# Azure Functions
BACKEND_API_URL=https://<function-app-name>.azurewebsites.net

# Cosmos DB (Managed Identity - no key needed)
COSMOS_DB_ENDPOINT=https://<cosmosdb-account-name>.documents.azure.com:443/
```

**Important**: In production, `COSMOS_DB_KEY` is not needed. Managed Identity handles authentication automatically.

### Setting Variables in Azure

**Static Web Apps:**

```bash
az staticwebapp appsettings set \
  --name <swa-name> \
  --setting-names \
    BACKEND_API_URL=https://<function-name>.azurewebsites.net \
    COSMOS_DB_ENDPOINT=https://<cosmosdb-name>.documents.azure.com:443/
```

**Azure Functions:**

```bash
az functionapp config appsettings set \
  --name <function-name> \
  --resource-group my-app-rg \
  --settings \
    COSMOS_DB_ENDPOINT=https://<cosmosdb-name>.documents.azure.com:443/
```

## Customizing Infrastructure

### Incremental Infrastructure Migrations

```
infra/
├── main.bicep               # Main orchestration
├── main.parameters.json     # Parameters
├── modules/                 # Baseline resources
└── migrations/
    ├── manifest.json        # Versions and checksums
    └── 0001-add-search/     # Standalone Bicep for added resources
```

Scaffolding a model generates its new Cosmos DB container as a migration. Create migrations for other resources explicitly:

```bash
npx swallowkit create-migration add-search
# Edit infra/migrations/0001-add-search/main.bicep
npx swallowkit provision -g my-app-rg --location japaneast --swa-location eastasia
```

`provision` compares the resource-group version/checksum tag with the local manifest and applies only pending migrations in ascending order. The tag advances after each successful migration. An interrupted wait/tag/ledger update must resume the original execution checkpoint, not create a fresh deployment. Never edit an applied migration; add a corrective migration instead.

### Projects Created by Older SwallowKit Versions

```bash
npx swallowkit migrations init --legacy-baseline
npx swallowkit provision -g my-app-rg \
  --location japaneast --swa-location eastasia \
  --adopt-existing --baseline 0 --what-if
```

The first command only records the current `infra/` directory as baseline 0; it does not contact Azure. Adoption also does not deploy `main.bicep`: after review it adds only the migration-state tag. Adoption stops when what-if contains Create/Delete changes so undeployed changes can be moved into migrations. Modify changes are warnings, allowing you to review portal-managed values such as Function App settings.

### Explicit Baseline Reconciliation

Use `--reconcile --what-if` only when baseline resources intentionally need a full update:

```bash
npx swallowkit provision -g my-app-rg \
  --location japaneast --swa-location eastasia \
  --reconcile --what-if
```

Reconcile redeploys all of `main.bicep` and may reset template-managed properties such as Function App settings. Normal `provision` never falls back to reconcile automatically.

## Troubleshooting

### Deployment Fails

**Symptom**: CI/CD pipeline fails with errors

**Solution**:
1. Check GitHub/Azure DevOps logs
2. Verify secrets are correctly set
3. Ensure Azure resources provisioned successfully

```bash
# Check resources
az resource list --resource-group my-app-rg --output table
```

### Cannot Connect to Functions

**Symptom**: BFF calls to Functions fail

**Solution**:
1. Verify `BACKEND_API_URL` is correctly set
2. Check CORS configuration

```bash
az functionapp cors show \
  --name <function-name> \
  --resource-group my-app-rg
```

3. Ensure Functions are running

```bash
az functionapp show \
  --name <function-name> \
  --resource-group my-app-rg \
  --query "state" -o tsv
```

### Cosmos DB Connection Error

**Symptom**: "Unauthorized" or connection errors

**Solution**:
1. Verify Managed Identity is enabled

```bash
az functionapp identity show \
  --name <function-name> \
  --resource-group my-app-rg
```

2. Check RBAC role assignment

```bash
az cosmosdb sql role assignment list \
  --account-name <cosmosdb-name> \
  --resource-group my-app-rg
```

3. Verify endpoint URL is correct

### Slow Builds

**Symptom**: Next.js build takes too long

**Solution**:
1. Use `.next` cache

```yaml
# .github/workflows/static-web-app.yml
- uses: actions/cache@v3
  with:
    path: .next/cache
    key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}
```

2. Ensure `standalone` mode is enabled (automatic)

## Next Steps

- [CLI Reference](./cli-reference.md) - All commands
- [Scaffold Guide](./scaffold-guide.md) - CRUD code generation
