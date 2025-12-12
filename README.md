# SwallowKit

[![npm version](https://img.shields.io/npm/v/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![npm downloads](https://img.shields.io/npm/dm/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![license](https://img.shields.io/npm/l/swallowkit.svg)](./LICENSE)

A type-safe, schema-driven development toolkit for Next.js applications on Azure, featuring seamless Zod schema sharing between frontend, backend, and Cosmos DB.

SwallowKit enables developers to build full-stack Next.js applications with external Azure Functions backends while maintaining end-to-end type safety through shared Zod schemas. Deploy your Next.js app to Azure Static Web Apps using standalone mode, and connect to independent Azure Functions for backend operations—all with consistent type definitions and validation.

> **Note**: This project is in active development. APIs may change in future versions.

## 🚀 Features

- **Zod Schema Sharing**: Share type-safe schemas across frontend, backend, and database layers
- **CRUD Code Generation**: Automatically generate Azure Functions and Next.js BFF code from Zod schemas
- **Type-Safe Cosmos DB**: Built-in Cosmos DB integration with automatic validation
- **Next.js Standalone Deployment**: Deploy to Azure Static Web Apps with standalone mode
- **External Backend Support**: Connect to independent Azure Functions backends
- **Repository Pattern**: Simple, type-safe data access with BaseModel and SchemaRepository
- **Full TypeScript**: End-to-end type safety from client to database
- **Azure Optimized**: Designed specifically for Azure Static Web Apps + Azure Functions + Cosmos DB
- **Developer Experience**: Simple CLI commands for development and deployment

## � Documentation

- **[Scaffold Guide](./docs/scaffold-guide.md)** - Generate CRUD operations from Zod schemas
- **[Zod Schema Sharing Guide](./docs/zod-schema-sharing-guide.md)** - Share schemas between Next.js and Azure Functions

## �📋 Prerequisites

- Node.js 22.x
- Azure Cosmos DB Emulator (for local development)
  - Windows: Install from [official site](https://aka.ms/cosmosdb-emulator)
  - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 📦 Installation

```bash
npm install swallowkit next react react-dom zod
```

SwallowKit requires Next.js 14+ and Zod as peer dependencies.

## 🛠️ Quick Start

### 1. Initialize SwallowKit Project

```bash
npx swallowkit init my-app
cd my-app
npm install
```

This creates a complete full-stack project with:
- Next.js app with App Router, TypeScript, and Tailwind CSS
- Azure Functions project with HTTP triggers
- BFF (Backend For Frontend) API routes
- Example Todo app with Cosmos DB integration
- Greet function demonstrating BFF → Azure Functions pattern

### 2. Install Azure Functions Core Tools

To run Azure Functions locally, install the Azure Functions Core Tools:

```bash
npm install -g azure-functions-core-tools@4
```

Or via chocolatey (Windows):
```bash
choco install azure-functions-core-tools
```

### 3. Start Development Environment

The init command creates two projects:
- **Next.js app** (frontend + BFF API routes)
- **Azure Functions** (backend services in `functions/` directory)

Start both servers with a single command:

```bash
npx swallowkit dev
```

This will:
- ✅ Check and setup Cosmos DB Emulator
- ✅ Start Azure Functions (automatically installs dependencies if needed)
- ✅ Start Next.js development server

The demo app will be available at:
- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

**Options:**
```bash
# Customize ports
npx swallowkit dev --port 3001 --functions-port 7072

# Skip Azure Functions (Next.js only)
npx swallowkit dev --no-functions

# Open browser automatically
npx swallowkit dev --open

# Verbose output
npx swallowkit dev --verbose
```

### 4. Generate CRUD Operations from Zod Schemas

Use the `scaffold` command to automatically generate complete CRUD operations:

```bash
npx swallowkit scaffold lib/models/product.ts
```

This generates Azure Functions, Next.js API routes, and type-safe UI components from your Zod schema.

📚 **See the [Scaffold Guide](./docs/scaffold-guide.md) for detailed instructions and examples.**

### 5. Project Structure

```
my-app/
├── app/                      # Next.js App Router
│   ├── api/                  # BFF API Routes
│   │   └── greet/            # Example: Calls Azure Functions
│   │       └── route.ts
│   └── page.tsx              # Homepage with demos
├── components/               # React Components
│   ├── AddTodoForm.tsx       # Todo form with Zod validation
│   ├── TodoItem.tsx          # Todo item component
│   └── GreetingDemo.tsx      # BFF → Functions demo
├── lib/
│   ├── database/             # Cosmos DB client & repository
│   │   ├── base-model.ts     # BaseModel class
│   │   ├── client.ts         # DatabaseClient
│   │   └── repository.ts     # SchemaRepository
│   ├── models/               # Zod schemas + models
│   │   └── todo.ts           # Todo schema & model
│   └── server/               # Server actions
│       └── todos.ts          # Todo CRUD operations
├── functions/                # Azure Functions Project
│   ├── src/
│   │   └── greet.ts          # Example HTTP trigger
│   ├── host.json
│   ├── local.settings.json
│   └── package.json
├── .env.local                # Environment variables
├── swallowkit.config.js      # SwallowKit configuration
└── staticwebapp.config.json  # Azure SWA config
```

### 5. Define Shared Zod Schemas

Create type-safe schemas that will be used across your entire stack:

```typescript
// lib/schemas/todo.ts
import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, 'Todo text is required'),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type Todo = z.infer<typeof TodoSchema>;
```

### 5. Define Shared Zod Schemas

Create type-safe schemas that will be used across your entire stack:

```typescript
// lib/models/todo.ts
import { z } from 'zod';
import { BaseModel } from '@/lib/database/base-model';

export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, 'Todo text is required').max(200),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type TodoType = z.infer<typeof todoSchema>;

export class Todo extends BaseModel<TodoType> {
  constructor() {
    super('AppDatabase', 'Todos', todoSchema);
  }
}
```

### 6. Use BFF Pattern for Azure Functions

Next.js API routes act as a BFF (Backend For Frontend) layer that calls Azure Functions:

```typescript
// app/api/greet/route.ts
import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || 'World';

  // Call Azure Functions backend
  const response = await fetch(`${FUNCTIONS_BASE_URL}/api/greet?name=${encodeURIComponent(name)}`);
  const data = await response.json();
  
  return NextResponse.json(data);
}
```

```typescript
// functions/src/functions/greet.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';

const greetRequestSchema = z.object({
  name: z.string().min(1).max(50),
});

export async function greet(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const name = request.query.get('name') || 'World';
  const result = greetRequestSchema.safeParse({ name });
  
  if (!result.success) {
    return { status: 400, jsonBody: { error: result.error.errors[0].message } };
  }

  return {
    status: 200,
    jsonBody: {
      message: `Hello, ${result.data.name}! This message is from Azure Functions.`,
      timestamp: new Date().toISOString()
    }
  };
}

app.http('greet', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: greet
});
```

### 7. Use Schemas in Client Components

```typescript
// components/AddTodoForm.tsx
'use client'

import { useState } from 'react';
import { addTodo } from '@/lib/server/todos';
import { todoSchema } from '@/lib/models/todo';

export function AddTodoForm() {
  const [text, setText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Client-side validation with Zod
    const result = todoSchema.pick({ text: true }).safeParse({ text });
    if (!result.success) {
      alert(result.error.errors[0].message);
      return;
    }

    await addTodo(text);
    setText('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit">Add Todo</button>
    </form>
  );
}
```

### 8. Develop and Deploy

```bash
# Start Next.js + Azure Functions + Cosmos DB with one command
npx swallowkit dev

# Generate CRUD operations for your models
npx swallowkit scaffold product
npx swallowkit scaffold order

# Build for production
npx swallowkit build

# Deploy to Azure
npx swallowkit deploy --swa-name my-app --resource-group my-rg
```

### 9. Rapid CRUD Development with Scaffold

SwallowKit can automatically generate all CRUD code for your models:

```bash
# 1. Create a Zod model
# lib/models/product.ts
import { z } from 'zod';

export const productSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  price: z.number().positive(),
});

# 2. Generate CRUD operations
npx swallowkit scaffold product

# 3. Done! You now have:
#    - Azure Functions with Cosmos DB bindings
#    - Next.js BFF API routes
#    - Full type safety with Zod validation
```

The generated code includes:
- ✅ List all items (`GET /api/product`)
- ✅ Get item by ID (`GET /api/product/{id}`)
- ✅ Create item (`POST /api/product`)
- ✅ Update item (`PUT /api/product/{id}`)
- ✅ Delete item (`DELETE /api/product/{id}`)

All with Azure best practices, Cosmos DB bindings, and Zod validation!

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App                          │
│  ┌──────────────┐      ┌──────────────────────────┐    │
│  │  Frontend    │      │  BFF API Routes          │    │
│  │  Components  │─────▶│  /api/*                  │    │
│  │  (Client)    │      │  (Next.js API Routes)    │    │
│  └──────────────┘      └──────────┬───────────────┘    │
│                                   │                      │
│                                   │ HTTP                 │
└───────────────────────────────────┼──────────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │   Azure Functions (External)    │
                    │   - HTTP Triggers               │
                    │   - Business Logic              │
                    │   - Zod Validation              │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │      Azure Cosmos DB            │
                    │   - NoSQL Database              │
                    │   - Schema Validation           │
                    └─────────────────────────────────┘
```

**Key Patterns:**
- **BFF (Backend For Frontend)**: Next.js API routes proxy requests to Azure Functions
- **Shared Schemas**: Zod schemas used in frontend, BFF, Functions, and database
- **Type Safety**: End-to-end TypeScript types derived from Zod schemas
- **Standalone Deployment**: Next.js deployed as standalone to Azure Static Web Apps
- **External Backend**: Azure Functions deployed independently

### Development & Deployment Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Development                              │
├─────────────────────────────────────────────────────────────┤
│  Next.js App (localhost:3000)                               │
│    ├─ Frontend Components                                    │
│    ├─ BFF API Routes (/api/*)                               │
│    └─ Server Actions (Cosmos DB)                            │
│                                                               │
│  Azure Functions (localhost:7071)                           │
│    └─ HTTP Triggers (greet, etc.)                           │
│                                                               │
│  Cosmos DB Emulator (localhost:8081)                        │
└─────────────────────────────────────────────────────────────┘

                        ↓ swallowkit build

┌─────────────────────────────────────────────────────────────┐
│                     Production (Azure)                       │
├─────────────────────────────────────────────────────────────┤
│  Azure Static Web Apps                                       │
│    └─ Next.js (standalone mode)                             │
│         ├─ Server Components (SSR)                           │
│         ├─ Client Components                                 │
│         └─ BFF API Routes                                    │
│                                                               │
│  Azure Functions (separate deployment)                      │
│    └─ Backend API (CRUD, business logic)                    │
│                                                               │
│  Azure Cosmos DB                                             │
│    └─ Data storage with Zod validation                      │
└─────────────────────────────────────────────────────────────┘
```

### Why This Approach?

**Problem**: Managing type consistency across frontend, backend, and database is error-prone and time-consuming.

**Solution**: SwallowKit provides a unified Zod schema layer that ensures type safety and validation across your entire stack:

```
Zod Schema (Single Source of Truth)
    ├─ Frontend: Client-side validation
    ├─ Next.js: Server component validation
    ├─ Backend: Azure Functions validation
    └─ Database: Cosmos DB document validation
```

## 🎯 Core Feature: Zod Schema Sharing

### Why Zod Schema Sharing?

1. **Single Source of Truth**: Define your data schema once with Zod
2. **Frontend Validation**: Use the same schema for client-side form validation
3. **Backend Validation**: Automatically validate inputs in Server Actions and API routes
4. **Database Schema**: Type-safe Cosmos DB operations with runtime validation
5. **No Code Duplication**: Share schemas between client, server, and database

### Basic Usage

```typescript
// lib/schemas/user.ts - Shared schema definition
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type User = z.infer<typeof UserSchema>;
```

```typescript
// lib/server/users.ts - Server-side repository
import { createRepository } from 'swallowkit';
import { UserSchema } from '../schemas/user';

const userRepo = createRepository('users', UserSchema);

export async function getUsers() {
  return userRepo.findAll(); // Type-safe, validated
}

export async function createUser(data: { name: string; email: string }) {
  return userRepo.create({
    id: crypto.randomUUID(),
    ...data,
  }); // Validated by Zod before saving to Cosmos DB
}
```

```typescript
// app/actions.ts - Server Actions with validation
'use server'

import { UserSchema } from '@/lib/schemas/user';
import { createUser } from '@/lib/server/users';
import { revalidatePath } from 'next/cache';

export async function createUserAction(formData: FormData) {
  // Validate input using the same schema
  const result = UserSchema.pick({ name: true, email: true }).safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
  });
  
  if (!result.success) {
    return { error: result.error.message };
  }
  
  await createUser(result.data);
  revalidatePath('/users');
}
```

```typescript
// components/UserForm.tsx - Client-side validation
'use client'

import { UserSchema } from '@/lib/schemas/user';
import { createUserAction } from '@/app/actions';
import { useState } from 'react';

export function UserForm() {
  const [error, setError] = useState('');
  
  const handleSubmit = async (formData: FormData) => {
    // Client-side validation using the same schema
    const result = UserSchema.pick({ name: true, email: true }).safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
    });
    
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    
    setError('');
    await createUserAction(formData);
  };
  
  return (
    <form action={handleSubmit}>
      <input name="name" required />
      <input name="email" type="email" required />
      {error && <p className="error">{error}</p>}
      <button>Create User</button>
    </form>
  );
}
```

## 🔧 Database Integration

### Repository API

```typescript
import { createRepository } from 'swallowkit';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const userRepo = createRepository('users', UserSchema);

// Create (with validation)
await userRepo.create({
  id: '1',
  name: 'John',
  email: 'john@example.com'
});

// Find by ID
const user = await userRepo.findById('1');

// Find all
const users = await userRepo.findAll();

// Update (with validation)
await userRepo.update({
  id: '1',
  name: 'John Doe',
  email: 'john@example.com'
});

// Delete
await userRepo.delete('1');

// Custom queries
const activeUsers = await userRepo.findWhere('c.isActive = true');
```

### Advanced: Custom Repository

```typescript
import { SchemaRepository } from 'swallowkit';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  isActive: z.boolean(),
});

class UserRepository extends SchemaRepository<z.infer<typeof UserSchema>> {
  constructor() {
    super('users', UserSchema);
  }
  
  async findActiveUsers() {
    return this.findWhere('c.isActive = true');
  }
  
  async findByEmail(email: string) {
    const users = await this.findWhere('c.email = @email', [email]);
    return users[0] || null;
  }
}

export const userRepo = new UserRepository();
```

### Cosmos DB Client

For advanced use cases, you can use the Cosmos DB client directly:

```typescript
import { getDatabaseClient } from 'swallowkit';

const client = getDatabaseClient();

// Direct operations
await client.createDocument('users', { id: '1', name: 'John' });
await client.getDocument('users', '1');
await client.updateDocument('users', { id: '1', name: 'John Doe' });
await client.deleteDocument('users', '1');
await client.query('users', 'SELECT * FROM c WHERE c.isActive = true');
```

## 📚 CLI Commands

### `swallowkit init [project-name]`

Initialize a new SwallowKit project with Next.js template.

```bash
npx swallowkit init my-app
```

### `swallowkit dev`

Start development server with Cosmos DB setup and Next.js.

```bash
npx swallowkit dev
```

Options:
- `-p, --port <port>`: Next.js port (default: `3000`)
- `--host <host>`: Host name (default: `localhost`)
- `--open`: Open browser automatically
- `--verbose`: Show detailed logs

### `swallowkit build`

Build the Next.js app for production using standalone mode.

```bash
npx swallowkit build
```

Options:
- `--output <dir>`: Output directory (default: `dist`)

### `swallowkit deploy`

Deploy to Azure Static Web Apps.

```bash
npx swallowkit deploy --swa-name my-app --resource-group my-rg
```

Options:
- `--swa-name <name>`: Azure Static Web Apps resource name (required)
- `--resource-group <name>`: Azure resource group (required)
- `--location <location>`: Azure region (default: `japaneast`)
- `--skip-build`: Skip build step

### `swallowkit setup`

Install required tools (Azure CLI, SWA CLI, Cosmos DB Emulator).

```bash
npx swallowkit setup
```

### `swallowkit scaffold <model>`

Generate CRUD operations (Create, Read, Update, Delete, List) for a Zod model.

This command reads a Zod schema file and automatically generates:
- Azure Functions with Cosmos DB bindings for all CRUD operations
- Next.js BFF API routes that call the Azure Functions
- Type-safe code using your shared Zod schema

```bash
# Generate CRUD for a model file
npx swallowkit scaffold todo

# Or specify the full path
npx swallowkit scaffold lib/models/todo.ts
```

**Options:**
- `--functions-dir <dir>`: Azure Functions directory (default: `functions`)
- `--api-dir <dir>`: Next.js API routes directory (default: `app/api`)

**Example:**

1. Create a Zod model file:

```typescript
// lib/models/product.ts
import { z } from 'zod';

export const productSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  price: z.number().positive(),
  description: z.string().optional(),
  inStock: z.boolean().default(true),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type ProductType = z.infer<typeof productSchema>;
```

2. Generate CRUD operations:

```bash
npx swallowkit scaffold product
```

3. This creates:
   - `functions/src/functions/product.ts` - Azure Functions (GET, POST, PUT, DELETE)
   - `app/api/product/route.ts` - Next.js BFF (GET all, POST)
   - `app/api/product/[id]/route.ts` - Next.js BFF (GET by ID, PUT, DELETE)

**Generated Azure Functions:**
- `GET /api/product` - List all items (with Cosmos DB input binding)
- `GET /api/product/{id}` - Get item by ID (with Cosmos DB input binding)
- `POST /api/product` - Create new item (with Cosmos DB output binding)
- `PUT /api/product/{id}` - Update item (with Cosmos DB output binding)
- `DELETE /api/product/{id}` - Delete item (using Cosmos DB client)

**Generated Next.js BFF Routes:**
- `GET /api/product` - Proxy to Azure Functions
- `POST /api/product` - Proxy to Azure Functions (with client-side validation)
- `GET /api/product/[id]` - Proxy to Azure Functions
- `PUT /api/product/[id]` - Proxy to Azure Functions (with client-side validation)
- `DELETE /api/product/[id]` - Proxy to Azure Functions

All generated code:
- ✅ Uses Azure Functions input/output bindings for optimal performance
- ✅ Follows Azure best practices
- ✅ Validates data with your shared Zod schema
- ✅ Maintains end-to-end type safety
- ✅ Includes proper error handling

## 🔧 Configuration

Create `swallowkit.config.js` in your project root:

```javascript
module.exports = {
  database: {
    connectionString: process.env.COSMOS_DB_CONNECTION_STRING,
    databaseName: 'MyAppDB',
  },
  api: {
    endpoint: '/api/_swallowkit',
    cors: {
      origin: ['http://localhost:3000'],
      credentials: true,
    },
  },
};
```

## 🚀 Connecting to External Azure Functions

SwallowKit is designed to work with external Azure Functions backends. Your Next.js app acts as a BFF (Backend for Frontend), while independent Azure Functions handle business logic and data operations.

### Backend Connection Pattern

```typescript
// lib/api/backend.ts
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:7071';

export async function fetchFromBackend<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`Backend API error: ${response.statusText}`);
  }
  return response.json();
}
```

```typescript
// app/api/todos/route.ts - Next.js API Route (BFF)
import { fetchFromBackend } from '@/lib/api/backend';
import { TodoSchema } from '@/lib/schemas/todo';

export async function GET() {
  const todos = await fetchFromBackend('/api/todos');
  
  // Validate response using shared schema
  const validated = z.array(TodoSchema).parse(todos);
  
  return Response.json(validated);
}
```

## 🗺️ Roadmap

SwallowKit is currently in beta. The following features are planned for future releases:

### ✅ Completed Features (v0.1.0-beta.2+)

- **`swallowkit scaffold` command**: ✅ Generate CRUD operations from Zod models
  - Automatically creates Azure Functions with Cosmos DB bindings
  - Generates Next.js BFF API routes
  - Maintains end-to-end type safety with Zod validation

### Planned Features

- **`swallowkit build` command**: Build Next.js app in standalone mode for Azure Static Web Apps deployment
- **`swallowkit deploy` command**: Automated deployment to Azure Static Web Apps with Azure Functions
- **`swallowkit setup` command**: One-click installation of Azure CLI, SWA CLI, and development tools
- **Cosmos DB Integration**: 
  - Built-in Cosmos DB client with automatic connection management
  - `BaseModel` and `SchemaRepository` for type-safe database operations
  - Automatic Cosmos DB Emulator detection and setup
  - Database initialization and migration support
- **Advanced CLI Features**:
  - `swallowkit generate` command for scaffolding components, schemas, and API routes
  - Interactive project setup with customizable templates
  - Environment configuration wizard
- **Enhanced Developer Experience**:
  - Hot reload for Azure Functions during development
  - Integrated debugging support for Next.js + Functions
  - Better error messages and troubleshooting guides
- **Production Features**:
  - Environment-specific configuration management
  - Automated testing setup for Zod schemas
  - Performance monitoring integration with Application Insights
  - CI/CD pipeline templates for GitHub Actions and Azure DevOps

### Current Limitations

- `build`, `deploy`, and `setup` commands are not yet implemented
- Cosmos DB integration is included in the codebase but not connected to the init workflow
- Advanced scaffolding features (components, schemas) are planned
- Azure deployment requires manual configuration of Static Web Apps and Functions

## 📄 License

MIT

## 🔗 Related Links

- [Azure Static Web Apps](https://azure.microsoft.com/services/app-service/static/)
- [Azure Functions](https://azure.microsoft.com/services/functions/)
- [Azure Cosmos DB](https://azure.microsoft.com/services/cosmos-db/)
- [Next.js](https://nextjs.org/)
- [Zod](https://zod.dev/)
- [TypeScript](https://www.typescriptlang.org/)
