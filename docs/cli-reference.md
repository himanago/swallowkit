# CLI Reference

Comprehensive reference for all SwallowKit CLI commands and options.

## Table of Contents

- [swallowkit init](#swallowkit-init)
- [swallowkit dev](#swallowkit-dev)
- [swallowkit scaffold](#swallowkit-scaffold)
- [swallowkit provision](#swallowkit-provision)

## swallowkit init

Initialize a new SwallowKit project.

### Usage

```bash
npx swallowkit init [project-name] [options]
```

### Arguments

- `project-name` (optional): Project name. Initializes in current directory if omitted

### Options

Currently no options. Interactive prompts guide project setup.

### Interactive Prompts

1. **CI/CD Provider**: GitHub Actions or Azure Pipelines
2. **Project Configuration**: Automatically applies optimal settings

### Generated Files

```
my-app/
├── app/                      # Next.js App Router
│   ├── api/greet/            # BFF sample
│   ├── layout.tsx
│   └── page.tsx
├── components/               # React components
├── lib/
│   ├── api/backend.ts        # BFF client (api.get/post/put/delete)
│   ├── database/             # Cosmos DB client (optional)
│   │   ├── client.ts         # CosmosClient
│   │   └── repository.ts     # Repository pattern
│   ├── models/               # Data models
│   └── schemas/              # Zod schemas
├── functions/                # Azure Functions
│   ├── src/functions/
│   │   └── greet.ts          # Sample HTTP trigger
│   ├── host.json
│   ├── local.settings.json
│   └── package.json
├── infra/                    # Bicep IaC
│   ├── main.bicep
│   ├── main.parameters.json
│   └── modules/
│       ├── staticwebapp.bicep
│       ├── functions.bicep
│       └── cosmosdb.bicep
├── .github/workflows/        # CI/CD (GitHub Actions)
│   ├── static-web-app.yml
│   └── azure-functions.yml
├── .env.local                # Environment variables
├── .env.example
├── next.config.js
├── swallowkit.config.js
├── staticwebapp.config.json
└── package.json
```

### Examples

```bash
# Initialize in current directory
npx swallowkit init

# Initialize in new directory
npx swallowkit init my-awesome-app

# After initialization
cd my-awesome-app
npm install
```

## swallowkit dev

Start development servers (Next.js + Azure Functions).

### Usage

```bash
npx swallowkit dev [options]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--port <port>` | `-p` | Next.js port | `3000` |
| `--functions-port <port>` | | Azure Functions port | `7071` |
| `--host <host>` | | Host name | `localhost` |
| `--open` | `-o` | Auto-open browser | `false` |
| `--no-functions` | | Skip Functions | `false` |
| `--verbose` | `-v` | Show detailed logs | `false` |

### Behavior

1. **Cosmos DB Emulator Check**: Verify local emulator is running
2. **Azure Functions Start**: 
   - Check Azure Functions Core Tools
   - Auto-install dependencies
   - Start Functions in `functions/` directory
3. **Next.js Start**: Launch development server

### Examples

```bash
# Start with default settings
npx swallowkit dev

# Start with custom ports
npx swallowkit dev --port 3001 --functions-port 7072

# Auto-open browser
npx swallowkit dev --open

# Next.js only (no Functions)
npx swallowkit dev --no-functions

# Verbose logging
npx swallowkit dev --verbose
```

### Troubleshooting

**Cosmos DB Emulator not found:**
```
Error: Cosmos DB Emulator is not running
```

Solution:
- Windows: Install from [official site](https://aka.ms/cosmosdb-emulator)
- Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

**Azure Functions Core Tools missing:**
```
Error: Azure Functions Core Tools not found
```

Solution:
```bash
npm install -g azure-functions-core-tools@4
```

**Port in use:**
```
Error: Port 3000 is already in use
```

Solution:
```bash
npx swallowkit dev --port 3001
```

## swallowkit scaffold

Auto-generate CRUD operations from Zod schemas.

### Usage

```bash
npx swallowkit scaffold <model-file> [options]
```

### Arguments

- `model-file` (required): Path to model file containing Zod schema

### Options

Currently no options.

### Generated Code

**1. Azure Functions (CRUD endpoints)**

```typescript
// functions/src/functions/{resource}.ts
- GET    /api/{resource}       - Get all
- GET    /api/{resource}/{id}  - Get by ID
- POST   /api/{resource}       - Create
- PUT    /api/{resource}/{id}  - Update
- DELETE /api/{resource}/{id}  - Delete
```

Each endpoint includes:
- ✅ Cosmos DB input/output bindings
- ✅ Automatic Zod schema validation
- ✅ Error handling
- ✅ TypeScript type safety
- ✅ Factory pattern support (shared `crud-factory.ts`)

**2. Next.js BFF API Routes**

```typescript
// app/api/{resource}/route.ts
// app/api/{resource}/[id]/route.ts
```

Each route:
- ✅ Calls Azure Functions backend
- ✅ Automatic schema validation
- ✅ Error handling

**3. React Components (optional)**

```typescript
// components/{Resource}List.tsx
// components/{Resource}Form.tsx
```

### Prerequisites

**Model file requirements:**

```typescript
// lib/models/todo.ts
import { z } from 'zod';

// 1. Define Zod schema
export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

// 2. Infer type from schema
export type TodoType = z.infer<typeof todoSchema>;
```

### Examples

```bash
# Generate CRUD from Todo model
npx swallowkit scaffold lib/models/todo.ts

# Generate CRUD from Product model
npx swallowkit scaffold lib/models/product.ts

```

### Usage After Generation

**From frontend:**

```typescript
import { api } from '@/lib/api/backend';
import type { TodoType } from '@/lib/models/todo';

// Get all
const todos = await api.get<TodoType[]>('/api/todos');

// Create (validated by backend)
const created = await api.post<TodoType>('/api/todos', {
  text: 'Buy milk',
  completed: false
});

// Update (validated by backend)
const updated = await api.put<TodoType>('/api/todos/123', {
  completed: true
});

// Delete
await api.delete('/api/todos/123');
```

### Details

See [Scaffold Guide](./scaffold-guide.md) for more information.

## swallowkit provision

Provision Azure resources using Bicep.

### Usage

```bash
npx swallowkit provision [options]
```

### Options

| Option | Short | Description | Required |
|--------|-------|-------------|----------|
| `--resource-group <name>` | `-g` | Resource group name | ✅ |
| `--location <location>` | `-l` | Azure region | ✅ |
| `--subscription <id>` | | Subscription ID | |

### Azure Regions

Recommended regions:
- `japaneast` - Japan East
- `japanwest` - Japan West
- `eastus2` - East US 2
- `westeurope` - West Europe

List all regions:
```bash
az account list-locations --output table
```

### Generated Resources

1. **Azure Static Web Apps**
   - SKU: Free
   - Build config: standalone Next.js

2. **Azure Functions**
   - Plan: Consumption (pay-per-execution)
   - Runtime: Node.js 22
   - OS: Linux

3. **Azure Cosmos DB**
   - Mode: Serverless
   - API: NoSQL
   - Consistency: Session

4. **Azure Storage Account**
   - For Functions storage
   - SKU: Standard_LRS

5. **Managed Identity**
   - Type: System-assigned
   - Role: Cosmos DB Data Contributor

### Examples

```bash
# Basic usage
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast

# With subscription
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast \
  --subscription "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Short options
npx swallowkit provision -g my-app-rg -l japaneast
```

### After Provisioning

```bash
# List resources
az resource list --resource-group my-app-rg --output table

# Get Static Web Apps URL
az staticwebapp show \
  --name <swa-name> \
  --resource-group my-app-rg \
  --query "defaultHostname" -o tsv

# Get Functions URL
az functionapp show \
  --name <function-name> \
  --resource-group my-app-rg \
  --query "defaultHostName" -o tsv
```

### Customizing Bicep Files

Edit Bicep files in `infra/` before provisioning:

```bicep
// infra/modules/functions.bicep

// Change Consumption → Premium
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: functionAppName
  location: location
  sku: {
    name: 'EP1'  // Premium Elastic
    tier: 'ElasticPremium'
  }
}
```

After editing, run `swallowkit provision` again to apply changes.

### Troubleshooting

**Resource group doesn't exist:**
```bash
# Create it
az group create --name my-app-rg --location japaneast
```

**Resources unavailable in region:**
```bash
# Check available regions
az provider show --namespace Microsoft.Web \
  --query "resourceTypes[?resourceType=='staticSites'].locations" -o table
```

**Quota exceeded:**
```bash
# Check quota
az vm list-usage --location japaneast --output table
```

## Global Options

Available for all commands:

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--version` | Show version |

## Environment Variables

Control CLI behavior with environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `SWALLOWKIT_LOG_LEVEL` | Log level (debug/info/warn/error) | `info` |
| `COSMOS_DB_ENDPOINT` | Cosmos DB endpoint | `https://localhost:8081/` |
| `BACKEND_API_URL` | Functions URL | `http://localhost:7071` |

## Next Steps

- [Deployment Guide](./deployment-guide.md) - Deploy to Azure
- [Scaffold Guide](./scaffold-guide.md) - CRUD code generation details
- [Architecture Guide](./architecture.md) - System design
