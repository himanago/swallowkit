import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

interface InitOptions {
  name: string;
  template: string;
}

export async function initCommand(options: InitOptions) {
  console.log(`🚀 Initializing SwallowKit project: ${options.name}`);
  console.log(`📦 Template: ${options.template}`);

  const projectDir = path.join(process.cwd(), options.name);

  try {
    // Check if directory already exists
    if (fs.existsSync(projectDir)) {
      console.error(`❌ Directory "${options.name}" already exists.`);
      process.exit(1);
    }

    // Create project directory
    fs.mkdirSync(projectDir, { recursive: true });

    // Create Next.js project structure
    await createNextJsProject(projectDir, options);

    console.log(`\n✅ Project "${options.name}" created successfully!`);
    console.log("\n📝 Next steps:");
    console.log(`  cd ${options.name}`);
    console.log("  npm install");
    console.log("  npm run dev");
    console.log("\n💡 Azure Functions と統合するには:");
    console.log("  npx swallowkit generate");
    console.log("  npx swallowkit dev");
  } catch (error) {
    console.error("❌ Project creation failed:", error);
    // Clean up on failure
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
}

async function createNextJsProject(projectDir: string, options: InitOptions) {
  // Create package.json
  const packageJson = {
    name: options.name,
    version: "0.1.0",
    description: "SwallowKit Next.js application optimized for Azure",
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
      generate: "swallowkit generate",
      "build:azure": "swallowkit build",
      deploy: "swallowkit deploy"
    },
    dependencies: {
      "next": "^14.0.0",
      "react": "^18.0.0",
      "react-dom": "^18.0.0",
      "swallowkit": "latest",
      "zod": "^3.25.0"
    },
    devDependencies: {
      "@types/node": "^20.0.0",
      "@types/react": "^18.0.0",
      "@types/react-dom": "^18.0.0",
      "typescript": "^5.0.0",
      "autoprefixer": "^10.0.0",
      "postcss": "^8.0.0",
      "tailwindcss": "^3.0.0"
    }
  };

  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create TypeScript config
  const tsConfig = {
    compilerOptions: {
      target: "ES2017",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [
        {
          name: "next"
        }
      ],
      paths: {
        "@/*": ["./*"]
      }
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"]
  };

  fs.writeFileSync(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify(tsConfig, null, 2)
  );

  // Create Next.js config
  const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

module.exports = nextConfig
`;

  fs.writeFileSync(path.join(projectDir, "next.config.js"), nextConfig);

  // Create SwallowKit config
  const swallowkitConfig = {
    outputDir: './azure-functions',
    functionsVersion: 'v4',
    splitting: {
      perComponent: true,
      perAction: true,
    },
    database: {
      connectionString: process.env.COSMOS_DB_CONNECTION_STRING || 'AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
      databaseName: 'SwallowKitDB',
    }
  };

  fs.writeFileSync(
    path.join(projectDir, "swallowkit.config.js"),
    `module.exports = ${JSON.stringify(swallowkitConfig, null, 2)}\n`
  );

  // Create Tailwind CSS config
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;

  fs.writeFileSync(path.join(projectDir, "tailwind.config.js"), tailwindConfig);

  // Create PostCSS config
  const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;

  fs.writeFileSync(path.join(projectDir, "postcss.config.js"), postcssConfig);

  // Create .gitignore
  const gitignore = `# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# next.js
/.next/
/out/

# production
/build
/dist

# azure functions
/azure-functions/node_modules
/azure-functions/dist

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local
.env

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
`;

  fs.writeFileSync(path.join(projectDir, ".gitignore"), gitignore);

  // Create app directory structure
  const appDir = path.join(projectDir, "app");
  fs.mkdirSync(appDir, { recursive: true });

  // Create layout.tsx
  const layoutTsx = `import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '${options.name}',
  description: 'SwallowKit Next.js app optimized for Azure',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
`;

  fs.writeFileSync(path.join(appDir, "layout.tsx"), layoutTsx);

  // Create globals.css
  const globalsCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 214, 219, 220;
  --background-end-rgb: 255, 255, 255;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground-rgb: 255, 255, 255;
    --background-start-rgb: 0, 0, 0;
    --background-end-rgb: 0, 0, 0;
  }
}

body {
  color: rgb(var(--foreground-rgb));
  background: linear-gradient(
      to bottom,
      transparent,
      rgb(var(--background-end-rgb))
    )
    rgb(var(--background-start-rgb));
}
`;

  fs.writeFileSync(path.join(appDir, "globals.css"), globalsCss);

  // Create page.tsx (Server Component)
  const pageTsx = `import { AddTodoForm } from '@/components/AddTodoForm'
import { TodoItem } from '@/components/TodoItem'
import { getTodos } from '@/lib/server/todos'

// Force dynamic rendering (disable static generation)
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Home Page - Server Component
 * 
 * This demonstrates:
 * - Server Components for data fetching
 * - BaseModel usage for database operations
 * - Error handling with proper user feedback
 * - Integration with Client Components
 */
export default async function Home() {
  let todos = []
  let error = null
  
  try {
    todos = await getTodos()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to fetch todos'
    console.error('Error fetching todos:', e)
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            SwallowKit Todo
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            A full-stack Next.js app with Cosmos DB, optimized for Azure
          </p>
        </div>

        {/* Add Todo Form */}
        <div className="mb-8 bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
            Add New Todo
          </h2>
          <AddTodoForm />
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-8 p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-semibold text-red-800 dark:text-red-300">
                  Database Connection Error
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {error}
                </p>
                <p className="text-sm text-red-500 dark:text-red-500 mt-2">
                  💡 Make sure Cosmos DB Emulator is running on localhost:8081
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Todo List */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
              Your Todos
            </h2>
            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full text-sm font-medium">
              {todos.length} {todos.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {todos.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 text-lg">
                No todos yet. Add one above to get started!
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {todos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} />
              ))}
            </ul>
          )}
        </div>

        {/* Info Card */}
        <div className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            SwallowKit Features Demonstrated
          </h3>
          <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-300">
            <li className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <span><strong>BaseModel:</strong> Type-safe database operations with Zod validation</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <span><strong>Schema Sharing:</strong> Same validation on client and server</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <span><strong>Server Components:</strong> Data fetching at server-side</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <span><strong>Server Actions:</strong> Type-safe mutations without API routes</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 dark:text-blue-400">✓</span>
              <span><strong>Ready for Azure:</strong> Run <code className="px-1 bg-blue-100 dark:bg-blue-900 rounded">npx swallowkit generate</code> to create Azure Functions</span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  )
}
`;

  fs.writeFileSync(path.join(appDir, "page.tsx"), pageTsx);

  // Create actions.ts (Server Actions)
  const actionsTsx = `'use server'

import { revalidatePath } from 'next/cache'
import { Todo } from '@/lib/models/todo'
import { addTodo, toggleTodo, deleteTodo, updateTodoText } from '@/lib/server/todos'

/**
 * Server Action: Add a new todo
 * Validates input using Zod schema before creating
 */
export async function addTodoAction(formData: FormData) {
  const text = formData.get('text') as string
  
  // Validate using Zod schema (same schema used in the model)
  const result = Todo.schema.pick({ text: true }).safeParse({ text })
  
  if (!result.success) {
    return { error: result.error.errors[0].message }
  }

  try {
    await addTodo(text)
    revalidatePath('/')
    return { success: true }
  } catch (error) {
    return { error: 'Failed to add todo' }
  }
}

/**
 * Server Action: Toggle todo completion status
 */
export async function toggleTodoAction(id: string) {
  try {
    await toggleTodo(id)
    revalidatePath('/')
    return { success: true }
  } catch (error) {
    return { error: 'Failed to toggle todo' }
  }
}

/**
 * Server Action: Delete a todo
 */
export async function deleteTodoAction(id: string) {
  try {
    await deleteTodo(id)
    revalidatePath('/')
    return { success: true }
  } catch (error) {
    return { error: 'Failed to delete todo' }
  }
}

/**
 * Server Action: Update todo text
 */
export async function updateTodoTextAction(id: string, text: string) {
  // Validate using Zod schema
  const result = Todo.schema.pick({ text: true }).safeParse({ text })
  
  if (!result.success) {
    return { error: result.error.errors[0].message }
  }

  try {
    await updateTodoText(id, text)
    revalidatePath('/')
    return { success: true }
  } catch (error) {
    return { error: 'Failed to update todo' }
  }
}
`;

  fs.writeFileSync(path.join(appDir, "actions.ts"), actionsTsx);

  // Create components directory
  const componentsDir = path.join(projectDir, "components");
  fs.mkdirSync(componentsDir, { recursive: true });

  // Create AddTodoForm component
  const addTodoFormTsx = `'use client'

import { addTodoAction } from '@/app/actions'
import { useFormStatus } from 'react-dom'
import { Todo } from '@/lib/models/todo'
import { useState } from 'react'

function SubmitButton() {
  const { pending } = useFormStatus()
  
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Adding...' : 'Add Todo'}
    </button>
  )
}

/**
 * AddTodoForm Component
 * 
 * This demonstrates:
 * - Client-side validation using the same Zod schema from the model
 * - Server Actions for data mutation
 * - Progressive enhancement (works without JavaScript)
 */
export function AddTodoForm() {
  const [error, setError] = useState('')
  const [inputValue, setInputValue] = useState('')

  async function handleSubmit(formData: FormData) {
    const text = formData.get('text') as string
    
    // Client-side validation using the same Zod schema
    const result = Todo.schema.pick({ text: true }).safeParse({ text })
    
    if (!result.success) {
      setError(result.error.errors[0].message)
      return
    }

    setError('')
    const response = await addTodoAction(formData)
    
    if (response?.error) {
      setError(response.error)
    } else {
      setInputValue('') // Clear input on success
    }
  }

  return (
    <form action={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          name="text"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
        />
        <SubmitButton />
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">⚠️ {error}</p>
      )}
    </form>
  )
}
`;

  fs.writeFileSync(path.join(componentsDir, "AddTodoForm.tsx"), addTodoFormTsx);

  // Create TodoItem component
  const todoItemTsx = `'use client'

import { toggleTodoAction, deleteTodoAction } from '@/app/actions'
import { TodoType } from '@/lib/models/todo'
import { useState, useTransition } from 'react'

interface TodoItemProps {
  todo: TodoType
}

/**
 * TodoItem Component
 * 
 * This demonstrates:
 * - Optimistic UI updates with useTransition
 * - Server Actions for mutations
 * - Type safety with the Todo model's inferred type
 */
export function TodoItem({ todo }: TodoItemProps) {
  const [isPending, startTransition] = useTransition()
  const [isDeleting, setIsDeleting] = useState(false)

  function handleToggle() {
    startTransition(async () => {
      await toggleTodoAction(todo.id)
    })
  }

  function handleDelete() {
    if (confirm('Are you sure you want to delete this todo?')) {
      setIsDeleting(true)
      startTransition(async () => {
        await deleteTodoAction(todo.id)
      })
    }
  }

  return (
    <li
      className={\`flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-lg shadow transition-opacity \${
        isDeleting ? 'opacity-50' : ''
      }\`}
    >
      <button
        onClick={handleToggle}
        disabled={isPending || isDeleting}
        className="flex-shrink-0 w-5 h-5 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 transition-colors disabled:opacity-50"
        aria-label={todo.completed ? 'Mark as incomplete' : 'Mark as complete'}
      >
        {todo.completed && (
          <svg className="w-full h-full text-blue-600" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      <span
        className={\`flex-1 \${
          todo.completed
            ? 'line-through text-gray-500 dark:text-gray-400'
            : 'text-gray-900 dark:text-gray-100'
        }\`}
      >
        {todo.text}
      </span>

      <span className="text-xs text-gray-400 dark:text-gray-500">
        {new Date(todo.createdAt).toLocaleDateString()}
      </span>

      <button
        onClick={handleDelete}
        disabled={isPending || isDeleting}
        className="flex-shrink-0 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
        aria-label="Delete todo"
      >
        Delete
      </button>
    </li>
  )
}
`;

  fs.writeFileSync(path.join(componentsDir, "TodoItem.tsx"), todoItemTsx);

  // Create lib directory structure
  const libDir = path.join(projectDir, "lib");
  const modelsDir = path.join(libDir, "models");
  const serverDir = path.join(libDir, "server");
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });

  // Create Todo model using BaseModel
  const todoModelTsx = `import { z } from 'zod'
import { BaseModel } from 'swallowkit'

/**
 * Todo Model
 * 
 * This model uses SwallowKit's BaseModel which:
 * - Provides type-safe CRUD operations with Zod validation
 * - Ensures server-side only execution (throws error on client)
 * - Shares the same schema between client and server for validation
 */
export class Todo extends BaseModel {
  static schema = z.object({
    id: z.string(),
    text: z.string().min(1, 'Todo text is required'),
    completed: z.boolean().default(false),
    createdAt: z.string().default(() => new Date().toISOString()),
  })

  static container = 'Todos'
  static partitionKey = '/id'

  /**
   * Custom query: Find all incomplete todos
   * This demonstrates how to add custom static methods
   */
  static async findIncomplete() {
    return this.find('c.completed = false')
  }

  /**
   * Custom query: Find todos by text search
   */
  static async search(searchText: string) {
    return this.find('CONTAINS(c.text, @text)', [searchText])
  }
}

// Export the inferred type for use in components
export type TodoType = z.infer<typeof Todo.schema>
`

  fs.writeFileSync(path.join(modelsDir, 'todo.ts'), todoModelTsx)

  // Create server functions for Todo operations
  const todosTsx = `/**
 * Server-side Todo operations
 * 
 * These functions use the Todo model and will be called from Server Actions.
 * SwallowKit can convert these into individual Azure Functions.
 */

import { Todo } from '@/lib/models/todo'

export async function getTodos() {
  try {
    const todos = await Todo.find()
    return todos
  } catch (error) {
    console.error('Error fetching todos:', error)
    throw new Error('Failed to fetch todos')
  }
}

export async function getIncompleteTodos() {
  try {
    return await Todo.findIncomplete()
  } catch (error) {
    console.error('Error fetching incomplete todos:', error)
    throw new Error('Failed to fetch incomplete todos')
  }
}

export async function addTodo(text: string) {
  try {
    const newTodo = await Todo.create({
      id: crypto.randomUUID(),
      text,
      completed: false,
      createdAt: new Date().toISOString(),
    })
    return newTodo
  } catch (error) {
    console.error('Error creating todo:', error)
    throw new Error('Failed to create todo')
  }
}

export async function toggleTodo(id: string) {
  try {
    const todo = await Todo.findById(id)
    if (!todo) {
      throw new Error('Todo not found')
    }
    
    const updated = await Todo.update({
      ...todo,
      completed: !todo.completed,
    })
    return updated
  } catch (error) {
    console.error('Error toggling todo:', error)
    throw new Error('Failed to toggle todo')
  }
}

export async function deleteTodo(id: string) {
  try {
    await Todo.delete(id)
    return true
  } catch (error) {
    console.error('Error deleting todo:', error)
    throw new Error('Failed to delete todo')
  }
}

export async function updateTodoText(id: string, text: string) {
  try {
    const todo = await Todo.findById(id)
    if (!todo) {
      throw new Error('Todo not found')
    }
    
    const updated = await Todo.update({
      ...todo,
      text,
    })
    return updated
  } catch (error) {
    console.error('Error updating todo text:', error)
    throw new Error('Failed to update todo')
  }
}
`

  fs.writeFileSync(path.join(serverDir, 'todos.ts'), todosTsx)

  // Create README.md
  const readme = `# ${options.name}

A Next.js Todo application built with **SwallowKit**, demonstrating:
- ✅ **BaseModel**: Type-safe database operations with Zod validation
- ✅ **Schema Sharing**: Same validation schema on client and server
- ✅ **Server Components**: Data fetching with React Server Components
- ✅ **Server Actions**: Type-safe mutations without API routes
- ✅ **Cosmos DB**: Azure Cosmos DB integration with automatic setup
- ✅ **Azure Ready**: Deploy to Azure Static Web Apps + Azure Functions

## 🚀 Getting Started

### Prerequisites

**Cosmos DB Emulator** (for local development):

#### Option 1: Docker (Recommended for Linux/Mac/Codespaces)
\`\`\`bash
docker run -d \\
  --name cosmos-emulator \\
  -p 8081:8081 \\
  -p 10250-10255:10250-10255 \\
  -e AZURE_COSMOS_EMULATOR_PARTITION_COUNT=10 \\
  -e AZURE_COSMOS_EMULATOR_ENABLE_DATA_PERSISTENCE=true \\
  mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest
\`\`\`

Wait for the emulator to start (about 1 minute), then verify:
\`\`\`bash
curl -k https://localhost:8081/_explorer/index.html
\`\`\`

#### Option 2: Windows
Download from: https://aka.ms/cosmosdb-emulator

### Installation

\`\`\`bash
npm install
\`\`\`

### Development

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to see your app.

### How It Works

#### 1. Define Your Model with BaseModel

\`\`\`typescript
// lib/models/todo.ts
import { z } from 'zod'
import { BaseModel } from 'swallowkit'

export class Todo extends BaseModel {
  static schema = z.object({
    id: z.string(),
    text: z.string().min(1, 'Todo text is required'),
    completed: z.boolean().default(false),
    createdAt: z.string().default(() => new Date().toISOString()),
  })

  static container = 'Todos'
  static partitionKey = '/id'

  // Custom methods
  static async findIncomplete() {
    return this.find('c.completed = false')
  }
}
\`\`\`

#### 2. Use It in Server Components

\`\`\`typescript
// app/page.tsx (Server Component)
import { Todo } from '@/lib/models/todo'

export default async function Home() {
  const todos = await Todo.find()
  return <TodoList todos={todos} />
}
\`\`\`

#### 3. Mutations with Server Actions

\`\`\`typescript
// app/actions.ts
'use server'

import { Todo } from '@/lib/models/todo'
import { revalidatePath } from 'next/cache'

export async function addTodoAction(formData: FormData) {
  const text = formData.get('text') as string
  
  // Same Zod schema validates on both client and server
  const result = Todo.schema.pick({ text: true }).safeParse({ text })
  
  if (!result.success) {
    return { error: result.error.errors[0].message }
  }

  await Todo.create({
    id: crypto.randomUUID(),
    text,
    completed: false,
  })
  
  revalidatePath('/')
}
\`\`\`

#### 4. Client-Side Validation (Same Schema!)

\`\`\`typescript
// components/AddTodoForm.tsx
'use client'

import { Todo } from '@/lib/models/todo'

export function AddTodoForm() {
  // Client-side validation uses the same schema
  const result = Todo.schema.pick({ text: true }).safeParse({ text })
  
  if (!result.success) {
    setError(result.error.errors[0].message)
  }
  // ...
}
\`\`\`

### Generate Azure Functions

SwallowKit analyzes your Next.js app and generates individual Azure Functions:

\`\`\`bash
npx swallowkit generate
\`\`\`

This creates optimized Azure Functions from your Server Components and Server Actions.

### Build for Production

\`\`\`bash
npx swallowkit build
\`\`\`

### Deploy to Azure

\`\`\`bash
npx swallowkit deploy \\
  --swa-name your-app \\
  --functions-name your-functions \\
  --resource-group your-rg
\`\`\`

## 📁 Project Structure

\`\`\`
${options.name}/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page (Server Component)
│   ├── actions.ts          # Server Actions
│   └── globals.css         # Global styles
├── components/
│   ├── AddTodoForm.tsx     # Client component with validation
│   └── TodoItem.tsx        # Todo item component
├── lib/
│   ├── models/
│   │   └── todo.ts         # Todo model (BaseModel + Zod)
│   └── server/
│       └── todos.ts        # Server-side operations
├── azure-functions/        # Generated by 'swallowkit generate'
├── swallowkit.config.js    # SwallowKit configuration
└── package.json
\`\`\`

## 🎯 Key Features Demonstrated

### BaseModel Pattern
- Type-safe CRUD operations
- Automatic Zod validation
- Client-side execution prevention
- Custom query methods

### Schema Sharing
- Define once with Zod
- Validate on client (UX)
- Validate on server (security)
- Type-safe everywhere

### Server Components & Actions
- Data fetching at build/request time
- No API routes needed
- Progressive enhancement
- Optimistic UI updates

## 🔧 Environment Variables

Copy \`.env.example\` to \`.env.local\`:

\`\`\`bash
cp .env.example .env.local
\`\`\`

The default configuration works with Cosmos DB Emulator on localhost:8081.

## 📚 Learn More

- [SwallowKit Documentation](https://github.com/himanago/swallowkit)
- [Next.js Documentation](https://nextjs.org/docs)
- [Azure Cosmos DB](https://docs.microsoft.com/azure/cosmos-db/)
- [Azure Static Web Apps](https://docs.microsoft.com/azure/static-web-apps/)
- [Zod Documentation](https://zod.dev)

## 🐛 Troubleshooting

### "Database Connection Error"
Make sure Cosmos DB Emulator is running:
\`\`\`bash
# Check if emulator is running
curl -k https://localhost:8081/_explorer/index.html
\`\`\`

### "Failed to fetch todos"
The database and container are created automatically on first run. If you see this error:
1. Wait a moment for auto-creation to complete
2. Refresh the page
3. Check emulator logs for errors
`;

  fs.writeFileSync(path.join(projectDir, "README.md"), readme);

  // Create .env.example
  const envExample = `# Azure Cosmos DB Connection String
# For local development with emulator (default)
COSMOS_DB_CONNECTION_STRING=AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==

# For production (replace with your actual Cosmos DB connection string)
# COSMOS_DB_CONNECTION_STRING=AccountEndpoint=https://your-account.documents.azure.com:443/;AccountKey=your-primary-key

# Azure Configuration
AZURE_RESOURCE_GROUP=your-resource-group
AZURE_SWA_NAME=your-static-web-app-name
AZURE_FUNCTIONS_NAME=your-functions-app-name
`;

  fs.writeFileSync(path.join(projectDir, ".env.example"), envExample);

  // Create staticwebapp.config.json for Azure Static Web Apps
  const swaConfig = {
    navigationFallback: {
      rewrite: "/index.html"
    },
    routes: [
      {
        route: "/api/*",
        allowedRoles: ["anonymous"]
      }
    ],
    responseOverrides: {
      "404": {
        rewrite: "/404.html"
      }
    },
    globalHeaders: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block"
    },
    mimeTypes: {
      ".json": "application/json"
    }
  };

  fs.writeFileSync(
    path.join(projectDir, "staticwebapp.config.json"),
    JSON.stringify(swaConfig, null, 2)
  );

  console.log("\n✅ Project structure created");
}
