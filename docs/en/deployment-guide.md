# Deploy to Azure

See [package manager commands and troubleshooting](./package-managers.md) for pnpm 11/12 and npm usage.

Provision Azure resources and configure CI/CD for a SwallowKit project. After completing this guide, your application will be running on Azure Static Web Apps with an Azure Functions backend and Cosmos DB.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Generated Resources](#generated-resources)
- [CI/CD Setup](#cicd-setup)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Azure account
- Azure CLI (`az`) installed
- GitHub account (for GitHub Actions)
- Azure DevOps account (for Azure Pipelines)

## Quick Start

### 1. Initialize Project

```bash
npx swallowkit init my-app
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

If regions are omitted, the command prompts for them. On the first run it verifies that the resource group does not exist, deploys `infra/main.bicep`, and records migration baseline 0 in a resource-group tag. The plan and Azure commands are displayed for approval before anything is applied.

This creates using Bicep templates:
- Azure Static Web Apps
- Azure Functions (Flex Consumption)
- Azure Cosmos DB (the Free Tier or Serverless option selected during initialization)
- Managed Identity (secure service connections)

In non-interactive environments, pass `--location`, `--swa-location`, and `--approve`. Obtain CI/CD secrets with the Azure CLI commands later in this guide.

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

#### Step 4-2: Retrieve and register secrets / variables with Azure CLI

##### For GitHub Actions

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets using values retrieved with Azure CLI:
  - `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - `AZURE_FUNCTIONAPP_NAME`
  - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

##### For Azure Pipelines

1. Azure DevOps → Pipelines → Library → Variable groups
2. Create group named `azure-deployment`
3. Add the following variables using values retrieved with Azure CLI:
  - `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - `AZURE_FUNCTIONAPP_NAME`
  - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

#### Step 4-3: Manually re-run the CI/CD workflow

- **GitHub Actions**: Actions tab → select the failed workflow → Re-run all jobs
- **Azure Pipelines**: Pipelines → select the failed pipeline → Run pipeline

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
- **Runtime**: Selected during initialization (TypeScript/Node.js 22, C#/.NET Isolated 10.0, or Python 3.11)
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

`provision` compares the resource-group version/checksum tag with the local manifest and applies only pending migrations in ascending order. The tag advances after each successful migration, so a failure can be recovered by planning and applying again. Never edit an applied migration; add a corrective migration instead.

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
