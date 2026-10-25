import { FrontendFramework } from "../../types";
import { PackageManager, getCommands } from "../../utils/package-manager";
import { adaptReactPage } from "../scaffold/react-ui-generator";

export function buildHomePage(
  frontend: FrontendFramework,
  pm: PackageManager
): string {
  const framework = frontend === "react" ? "React" : "Next.js";
  const page = `import { useState } from 'react';
import Link from 'next/link';
import { scaffoldConfig } from '@/lib/scaffold-config';

export default function Home() {
  const [greetingStatus, setGreetingStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const testConnection = async () => {
    setGreetingStatus('loading');
    try {
      const response = await fetch('/api/greet?name=SwallowKit');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || \`Server error: \${response.status}\`);
      }
      setMessage(data.message);
      setGreetingStatus('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to connect to Azure Functions');
      setGreetingStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-800 dark:text-white mb-4">
            Welcome to SwallowKit
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            ${framework} on Azure Static Web Apps + Functions + Cosmos DB — Zod schema sharing
          </p>
        </header>

        <section className="max-w-2xl mx-auto mb-12">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Test BFF → Functions Connection
            </h2>
            <button
              onClick={testConnection}
              disabled={greetingStatus === 'loading'}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              {greetingStatus === 'loading' ? 'Testing...' : 'Test Connection'}
            </button>
            {greetingStatus === 'success' && (
              <div role="status" className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-green-800 dark:text-green-200 font-medium">✅ Connection successful!</p>
                <p className="text-green-700 dark:text-green-300 text-sm mt-1">{message}</p>
              </div>
            )}
            {greetingStatus === 'error' && (
              <div role="alert" className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-red-800 dark:text-red-200 font-medium">❌ Connection failed</p>
                <p className="text-red-700 dark:text-red-300 text-sm mt-1">{message}</p>
              </div>
            )}
          </div>
        </section>

        {scaffoldConfig.models.length > 0 ? (
          <section className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold mb-8 text-gray-900 dark:text-gray-100">Your Models</h2>
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {scaffoldConfig.models.map((model) => (
                <Link
                  key={model.name}
                  href={model.path}
                  className="block p-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-600 transition-all"
                >
                  <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">{model.label}</h3>
                  <p className="text-gray-600 dark:text-gray-400">Manage {model.label.toLowerCase()}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <section className="max-w-2xl mx-auto text-center">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-12 border border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Get Started</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Create your first model with Zod and generate CRUD operations automatically.
              </p>
              <code className="block bg-gray-100 dark:bg-gray-900 p-4 rounded text-left text-sm">
                ${getCommands(pm).exec} swallowkit scaffold shared/models/your-model.ts
              </code>
            </div>
          </section>
        )}

        <footer className="mt-16 text-center text-gray-600 dark:text-gray-400 text-sm">
          <p>Built with SwallowKit</p>
        </footer>
      </div>
    </div>
  );
}
`;
  return frontend === "react"
    ? adaptReactPage(page)
    : `'use client'\n\nexport const dynamic = 'force-dynamic';\n\n${page}`;
}
