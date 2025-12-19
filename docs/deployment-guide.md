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

### 3. Configure CI/CD Secrets

#### For GitHub Actions

**Get Static Web Apps deployment token:**

```bash
az staticwebapp secrets list \
  --name <swa-name> \
  --resource-group my-app-rg \
  --query "properties.apiKey" -o tsv
```

**Add secret to GitHub repository:**
1. Go to Settings → Secrets and variables → Actions
2. Add `AZURE_STATIC_WEB_APPS_API_TOKEN`

**Get Functions publish profile:**

```bash
az functionapp deployment list-publishing-profiles \
  --name <function-name> \
  --resource-group my-app-rg \
  --xml
```

**Add to GitHub secrets:**
- Add `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

#### For Azure Pipelines

**Create variable group:**
1. Azure DevOps → Pipelines → Library → Variable groups
2. Create group named `azure-deployment`
3. Add:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

### 4. Deploy

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

CI/CD workflows will run automatically.

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

**Change Functions plan:**

```bicep
// infra/modules/functions.bicep
resource functionApp 'Microsoft.Web/sites@2022-03-01' = {
  kind: 'functionapp'
  properties: {
    serverFarmId: appServicePlan.id
    // Change to Premium plan
  }
}
```

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

- [Architecture Guide](./architecture.md) - System design details
- [CLI Reference](./cli-reference.md) - All commands
- [Scaffold Guide](./scaffold-guide.md) - CRUD code generation
