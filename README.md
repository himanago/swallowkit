# SwallowKit

A Next.js framework for building full-stack applications optimized for Azure deployment.

SwallowKit enables you to build Next.js applications following standard React Server Components and Server Actions patterns, then automatically split them into individual Azure Functions to overcome Azure Static Web Apps' 250MB size limit.

> **Note**: This project is in early development. APIs may change in future versions.

## 🚀 Features

- **Next.js Standard Approach**: Build with standard Next.js SSR, Server Components, and Server Actions
- **Automatic Function Splitting**: CLI command splits SSR components/actions into individual Azure Functions
- **Zod Schema Sharing**: Share type-safe schemas between frontend, backend, and Cosmos DB
- **Azure Static Web Apps Optimization**: Overcomes 250MB deployment size limit
- **Independent Azure Functions**: Deploy backend functions separately from SWA
- **Cosmos DB Integration**: Built-in Cosmos DB support with automatic setup
- **Type-Safe**: Full TypeScript support with end-to-end type safety
- **Azure Optimized**: Designed for Azure Static Web Apps + Azure Functions v4
- **Developer Experience**: Simple CLI commands for build and deployment

## 📋 Prerequisites

- Node.js 22.x
- Azure Cosmos DB Emulator (for local development)
  - Windows: Install from [official site](https://aka.ms/cosmosdb-emulator)
  - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 📦 Installation

```bash
npm install swallowkit next react react-dom
```

SwallowKit requires Next.js 14+ as a peer dependency, but you don't need to use Next.js APIs directly.

## 🛠️ Quick Start

### 1. Initialize SwallowKit Project

```bash
npx swallowkit init my-app
cd my-app
npm install
```

### 2. Write Standard Next.js Code

Build your application using standard Next.js patterns:

```typescript
// app/page.tsx - Server Component
import { getTodos } from '@/lib/server/todos';

export default async function TodoPage() {
  const todos = await getTodos();
  
  return (
    <div>
      <h1>Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <AddTodoForm />
    </div>
  );
}
```

```typescript
// app/actions.ts - Server Actions
'use server'

import { revalidatePath } from 'next/cache';
import { addTodo } from '@/lib/server/todos';

export async function addTodoAction(formData: FormData) {
  const text = formData.get('text') as string;
  await addTodo(text);
  revalidatePath('/');
}
```

```typescript
// components/AddTodoForm.tsx - Client Component
'use client'

import { addTodoAction } from '@/app/actions';
import { useFormStatus } from 'react-dom';

export function AddTodoForm() {
  return (
    <form action={addTodoAction}>
      <input name="text" required />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>Add</button>;
}
```

### 3. Build and Deploy with SwallowKit CLI

```bash
# Generate individual Azure Functions from your Next.js app
npx swallowkit generate

# Build for production
npx swallowkit build

# Deploy to Azure
npx swallowkit deploy
```

The `generate` command automatically:
- Analyzes your Next.js app
- Identifies Server Components and Server Actions
- Splits them into individual Azure Functions
- Generates Azure Functions v4 compatible code
- Creates deployment configuration

## 🏗️ Architecture

### Development Flow

1. **Develop** with standard Next.js (SSR, RSC, Server Actions)
2. **Generate** individual Azure Functions with SwallowKit CLI
3. **Deploy** to Azure Static Web Apps + Azure Functions

### Why This Approach?

**Problem**: Azure Static Web Apps has a 250MB deployment size limit. Next.js apps with SSR often exceed this limit because the backend bundle is not optimized.

**Solution**: SwallowKit splits your SSR components and Server Actions into individual, optimized Azure Functions:

```
Next.js App Structure          →    Generated Azure Functions
├── app/
│   ├── page.tsx (SSR)        →    ├── functions/
│   ├── todos/                     │   ├── page-root/
│   │   └── page.tsx (SSR)    →    │   │   └── index.ts
│   └── actions.ts            →    │   ├── page-todos/
│                                  │   │   └── index.ts
│                                  │   └── actions-addTodo/
│                                  │       └── index.ts
│                                  └── static/ (Client Components)
```

Each function is:
- **Independently deployable** to Azure Functions
- **Optimized and tree-shaken** for size
- **Can scale independently**
- **Not limited by SWA's 250MB constraint**

## 🎯 Usage Patterns

### Server Components (SSR)

```typescript
// app/users/page.tsx
import { getUsers } from '@/lib/server/users';

export default async function UsersPage() {
  const users = await getUsers();
  return <UserList users={users} />;
}
```

### Server Actions

```typescript
// app/users/actions.ts
'use server'

export async function createUser(formData: FormData) {
  const name = formData.get('name') as string;
  // ... create user
  revalidatePath('/users');
}
```

### Client Components with Server Actions

```typescript
// components/CreateUserForm.tsx
'use client'

import { createUser } from '@/app/users/actions';

export function CreateUserForm() {
  return (
    <form action={createUser}>
      <input name="name" required />
      <button>Create</button>
    </form>
  );
}
```

## 📚 CLI Commands

### `swallowkit init [project-name]`

Initialize a new SwallowKit project with Next.js template.

```bash
npx swallowkit init my-app
```

### `swallowkit generate`

Analyze your Next.js app and generate individual Azure Functions.

```bash
npx swallowkit generate
```

Options:
- `--output-dir <dir>`: Output directory for generated functions (default: `./azure-functions`)
- `--config <file>`: Custom configuration file

### `swallowkit build`

Build the Next.js app and Azure Functions for production.

```bash
npx swallowkit build
```

### `swallowkit deploy`

Deploy to Azure Static Web Apps and Azure Functions.

```bash
npx swallowkit deploy
```

Options:
- `--swa-name <name>`: Azure Static Web Apps resource name
- `--functions-name <name>`: Azure Functions resource name
- `--resource-group <name>`: Azure resource group

### `swallowkit dev`

Start development server.

```bash
npx swallowkit dev
```

## 🔧 Configuration

Create `swallowkit.config.js` in your project root:

```javascript
module.exports = {
  // Output directory for generated Azure Functions
  outputDir: './azure-functions',
  
  // Azure Functions runtime version
  functionsVersion: 'v4',
  
  // Function splitting strategy
  splitting: {
    // Split each Server Component into a separate function
    perComponent: true,
    
    // Split each Server Action into a separate function
    perAction: true,
  },
  
  // Azure Static Web Apps configuration
  staticWebApp: {
    appLocation: './',
    apiLocation: './azure-functions',
    outputLocation: '.next',
  },
  
  // Database configuration
  database: {
    type: 'cosmosdb',
    connectionString: process.env.COSMOS_DB_CONNECTION_STRING,
  },
};
```

## 🔧 Database Integration

SwallowKit's **Zod Schema Sharing** is a killer feature that enables type-safe data flow across your entire stack:

### Why Zod Schema Sharing?

1. **Single Source of Truth**: Define your data schema once with Zod
2. **Frontend Validation**: Use the same schema for client-side form validation
3. **Backend Validation**: Automatically validate Server Actions input
4. **Database Schema**: Type-safe Cosmos DB operations with runtime validation
5. **No Code Duplication**: Share schemas between client, server, and database

### Basic Usage

```typescript
// lib/schemas/todo.ts - Shared schema definition
import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, 'Todo text is required'),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type Todo = z.infer<typeof TodoSchema>;
```

```typescript
// lib/server/todos.ts - Server-side repository
import { createRepository } from 'swallowkit';
import { TodoSchema } from '../schemas/todo';

const todoRepo = createRepository('todos', TodoSchema);

export async function getTodos() {
  return todoRepo.findAll(); // Type-safe, validated
}

export async function addTodo(text: string) {
  return todoRepo.create({
    id: crypto.randomUUID(),
    text,
    completed: false,
  }); // Validated by Zod before saving to Cosmos DB
}
```

```typescript
// app/actions.ts - Server Actions with validation
'use server'

import { TodoSchema } from '@/lib/schemas/todo';
import { addTodo } from '@/lib/server/todos';
import { revalidatePath } from 'next/cache';

export async function addTodoAction(formData: FormData) {
  // Validate input using the same schema
  const result = TodoSchema.pick({ text: true }).safeParse({
    text: formData.get('text'),
  });
  
  if (!result.success) {
    return { error: result.error.message };
  }
  
  await addTodo(result.data.text);
  revalidatePath('/');
}
```

```typescript
// components/AddTodoForm.tsx - Client-side validation
'use client'

import { TodoSchema } from '@/lib/schemas/todo';
import { addTodoAction } from '@/app/actions';
import { useState } from 'react';

export function AddTodoForm() {
  const [error, setError] = useState('');
  
  const handleSubmit = async (formData: FormData) => {
    // Client-side validation using the same schema
    const result = TodoSchema.pick({ text: true }).safeParse({
      text: formData.get('text'),
    });
    
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    
    setError('');
    await addTodoAction(formData);
  };
  
  return (
    <form action={handleSubmit}>
      <input name="text" required />
      {error && <p className="error">{error}</p>}
      <button>Add</button>
    </form>
  );
}
```

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

## 🔧 Configuration

## 🤝 Contributing

This project is in early development. Feedback and suggestions are welcome!

## 📄 License

MIT

## 🔗 Related Links

- [Azure Static Web Apps](https://azure.microsoft.com/services/app-service/static/)
- [Azure Functions](https://azure.microsoft.com/services/functions/)
- [Azure Cosmos DB](https://azure.microsoft.com/services/cosmos-db/)
- [React](https://reactjs.org/)
- [TypeScript](https://www.typescriptlang.org/)

