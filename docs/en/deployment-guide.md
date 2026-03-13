# Deployment Guide

This guide explains how to deploy SwallowKit applications to Azure.

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
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast
```

This creates using Bicep templates:
- Azure Static Web Apps
- Azure Functions (Consumption plan)
- Azure Cosmos DB (serverless)
- Managed Identity (secure service connections)

After provisioning completes, the terminal displays the secret values required for CI/CD:

```
=== CI/CD Secrets ===
AZURE_STATIC_WEB_APPS_API_TOKEN: <token-value>
AZURE_FUNCTIONAPP_PUBLISH_PROFILE: <profile-xml>
```

> **Important**: Copy these values — you will need them in step 4.

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

#### Step 4-2: Register the secrets displayed by `provision`

##### For GitHub Actions

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets using the values displayed after provisioning:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

##### For Azure Pipelines

1. Azure DevOps → Pipelines → Library → Variable groups
2. Create group named `azure-deployment`
3. Add the following variables using the values displayed after provisioning:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`
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

- **Plan**: Consumption (pay-per-execution)
- **Runtime**: Node.js 22
- **Features**:
  - HTTP triggers
  - Cosmos DB bindings
  - Zod schema validation

### Azure Cosmos DB

- **Mode**: Serverless
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

### Editing Bicep Files

```
infra/
├── main.bicep               # Main orchestration
├── main.parameters.json     # Parameters
└── modules/
    ├── staticwebapp.bicep   # SWA resource
    ├── functions.bicep      # Functions + Storage
    └── cosmosdb.bicep       # Cosmos DB + RBAC
```

### Applying Changes

```bash
# After editing Bicep files
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast
```

### Common Customizations

**Change Cosmos DB to provisioned:**

```bicep
// infra/modules/cosmosdb.bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  properties: {
    // serverless → provisioned
    capabilities: []
  }
}
```

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
