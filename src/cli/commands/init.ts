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
    console.log("\n💡 To generate Azure Functions:");
    console.log("  npx swallowkit generate");
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
      "swallowkit": "^0.2.0"
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
      type: 'cosmosdb',
      connectionString: process.env.COSMOS_DB_CONNECTION_STRING || '',
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
import { getTodos } from '@/lib/server/todos'

export default async function Home() {
  const todos = await getTodos()

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8">
          SwallowKit Todo App
        </h1>
        
        <div className="mb-8">
          <AddTodoForm />
        </div>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold mb-4">Todos</h2>
          {todos.length === 0 ? (
            <p className="text-gray-500">No todos yet. Add one above!</p>
          ) : (
            <ul className="space-y-2">
              {todos.map((todo) => (
                <li
                  key={todo.id}
                  className="flex items-center gap-2 p-4 bg-white dark:bg-gray-800 rounded-lg shadow"
                >
                  <span className={todo.completed ? 'line-through text-gray-500' : ''}>
                    {todo.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900 rounded-lg">
          <h3 className="font-semibold mb-2">🚀 Next Steps:</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Run <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">npx swallowkit generate</code> to create Azure Functions</li>
            <li>Run <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">npx swallowkit deploy</code> to deploy to Azure</li>
          </ol>
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
import { addTodo as addTodoDb, toggleTodo as toggleTodoDb, deleteTodo as deleteTodoDb } from '@/lib/server/todos'

export async function addTodoAction(formData: FormData) {
  const text = formData.get('text') as string
  
  if (!text || text.trim().length === 0) {
    return { error: 'Todo text is required' }
  }

  await addTodoDb(text)
  revalidatePath('/')
  
  return { success: true }
}

export async function toggleTodoAction(id: string) {
  await toggleTodoDb(id)
  revalidatePath('/')
  return { success: true }
}

export async function deleteTodoAction(id: string) {
  await deleteTodoDb(id)
  revalidatePath('/')
  return { success: true }
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

function SubmitButton() {
  const { pending } = useFormStatus()
  
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? 'Adding...' : 'Add Todo'}
    </button>
  )
}

export function AddTodoForm() {
  return (
    <form action={addTodoAction} className="flex gap-2">
      <input
        name="text"
        type="text"
        placeholder="What needs to be done?"
        required
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
      />
      <SubmitButton />
    </form>
  )
}
`;

  fs.writeFileSync(path.join(componentsDir, "AddTodoForm.tsx"), addTodoFormTsx);

  // Create lib directory structure
  const libDir = path.join(projectDir, "lib");
  const serverDir = path.join(libDir, "server");
  fs.mkdirSync(serverDir, { recursive: true });

  // Create todos.ts (server functions)
  const todosTsx = `// Server-side functions for Todo operations
// These will be converted to Azure Functions by SwallowKit

export interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: Date
}

// In-memory storage for demo (replace with Cosmos DB in production)
let todos: Todo[] = [
  {
    id: '1',
    text: 'Welcome to SwallowKit!',
    completed: false,
    createdAt: new Date(),
  },
  {
    id: '2',
    text: 'Run npx swallowkit generate',
    completed: false,
    createdAt: new Date(),
  },
]

export async function getTodos(): Promise<Todo[]> {
  // Simulate database delay
  await new Promise(resolve => setTimeout(resolve, 100))
  return todos
}

export async function addTodo(text: string): Promise<Todo> {
  const newTodo: Todo = {
    id: Date.now().toString(),
    text,
    completed: false,
    createdAt: new Date(),
  }
  
  todos.push(newTodo)
  return newTodo
}

export async function toggleTodo(id: string): Promise<Todo | null> {
  const todo = todos.find(t => t.id === id)
  if (todo) {
    todo.completed = !todo.completed
  }
  return todo || null
}

export async function deleteTodo(id: string): Promise<boolean> {
  const initialLength = todos.length
  todos = todos.filter(t => t.id !== id)
  return todos.length < initialLength
}
`;

  fs.writeFileSync(path.join(serverDir, "todos.ts"), todosTsx);

  // Create README.md
  const readme = `# ${options.name}

A Next.js application built with SwallowKit, optimized for Azure deployment.

## 🚀 Getting Started

### Development

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to see your app.

### Generate Azure Functions

SwallowKit analyzes your Next.js app and generates individual Azure Functions:

\`\`\`bash
npx swallowkit generate
\`\`\`

### Build for Production

\`\`\`bash
npx swallowkit build
\`\`\`

### Deploy to Azure

\`\`\`bash
npx swallowkit deploy --swa-name your-app --functions-name your-functions --resource-group your-rg
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
│   └── AddTodoForm.tsx     # Client component
├── lib/
│   └── server/
│       └── todos.ts        # Server functions
├── azure-functions/        # Generated by SwallowKit
├── next.config.js
├── swallowkit.config.js
└── package.json
\`\`\`

## 🏗️ Architecture

- **Development**: Standard Next.js with Server Components and Server Actions
- **Production**: SwallowKit splits SSR components into individual Azure Functions
- **Deployment**: Azure Static Web Apps (frontend) + Azure Functions (backend)

## 📚 Learn More

- [SwallowKit Documentation](https://github.com/himanago/swallowkit)
- [Next.js Documentation](https://nextjs.org/docs)
- [Azure Static Web Apps](https://docs.microsoft.com/azure/static-web-apps/)
`;

  fs.writeFileSync(path.join(projectDir, "README.md"), readme);

  // Create .env.example
  const envExample = `# Azure Cosmos DB
COSMOS_DB_CONNECTION_STRING=your-connection-string-here

# Azure Configuration
AZURE_RESOURCE_GROUP=your-resource-group
AZURE_SWA_NAME=your-static-web-app-name
AZURE_FUNCTIONS_NAME=your-functions-app-name
`;

  fs.writeFileSync(path.join(projectDir, ".env.example"), envExample);

  console.log("\n✅ Project structure created");
}
