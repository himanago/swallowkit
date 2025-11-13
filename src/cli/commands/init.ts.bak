import * as fs from "fs";
import * as path from "path";

interface InitOptions {
  name: string;
  template: string;
}

export async function initCommand(options: InitOptions) {
  console.log(`🚀 SwallowKitプロジェクトを初期化中: ${options.name}`);
  console.log(`📦 テンプレート: ${options.template}`);

  const projectDir = path.join(process.cwd(), options.name);

  try {
    // プロジェクトディレクトリを作成
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // 基本的なプロジェクト構造を作成
    await createProjectStructure(projectDir, options);

    console.log(`✅ プロジェクト "${options.name}" が正常に作成されました！`);
    console.log("\n次のステップ:");
    console.log(`  cd ${options.name}`);
    console.log("  npm install");
    console.log("  npm run dev");
  } catch (error) {
    console.error("❌ プロジェクトの作成に失敗しました:", error);
    process.exit(1);
  }
}

async function createProjectStructure(projectDir: string, options: InitOptions) {
  // package.json を作成
  const packageJson = {
    name: options.name,
    version: "0.1.0",
    description: "SwallowKit アプリケーション",
    main: "src/index.tsx",
    scripts: {
      dev: "swallowkit dev",
      build: "swallowkit build",
      start: "serve -s dist",
    },
    dependencies: {
      react: "^18.0.0",
      "react-dom": "^18.0.0",
      swallowkit: "^0.1.0",
      zod: "^3.22.0",
    },
    devDependencies: {
      "@types/react": "^18.0.0",
      "@types/react-dom": "^18.0.0",
      "@vitejs/plugin-react": "^4.0.0",
      autoprefixer: "^10.4.0",
      postcss: "^8.4.0",
      tailwindcss: "^3.4.0",
      typescript: "^5.0.0",
      vite: "^4.5.0",
    },
  };

  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // TypeScript設定
  const tsConfig = {
    compilerOptions: {
      target: "ES2020",
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      allowJs: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      moduleResolution: "node",
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: "react-jsx",
    },
    include: ["src"],
    references: [{ path: "./tsconfig.node.json" }],
  };

  fs.writeFileSync(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify(tsConfig, null, 2)
  );

  // SwallowKit設定ファイル
  const swallowkitConfig = {
    database: {
      type: "mock",
    },
    api: {
      endpoint: "/api/_swallowkit",
    },
    functions: {
      outputDir: "api",
    },
  };

  fs.writeFileSync(
    path.join(projectDir, "swallowkit.config.json"),
    JSON.stringify(swallowkitConfig, null, 2)
  );

  // srcディレクトリとファイルを作成
  const srcDir = path.join(projectDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  // メインのReactアプリ（Tailwind CSS + CRUD機能）
  const appTsx = `import React, { useState } from "react";
import { useServerFn, callServerFn } from "swallowkit";
import { getTodos, addTodo, deleteTodo, toggleTodo } from "./serverFns";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

function App() {
  const [newTodoText, setNewTodoText] = useState("");
  const { data: todos, loading, error, refetch } = useServerFn<Todo[]>(getTodos, []);

  const handleAddTodo = async () => {
    if (!newTodoText.trim()) return;
    
    await callServerFn(addTodo, { text: newTodoText });
    setNewTodoText("");
    refetch();
  };

  const handleToggleTodo = async (id: string) => {
    await callServerFn(toggleTodo, { id });
    refetch();
  };

  const handleDeleteTodo = async (id: string) => {
    await callServerFn(deleteTodo, { id });
    refetch();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-xl text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          エラー: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🚀 SwallowKit Todo
          </h1>
          <p className="text-gray-600 mb-8">
            Azure Static Web Apps + React Hooks フレームワーク
          </p>

          {/* 新規Todo追加フォーム */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleAddTodo()}
              placeholder="新しいタスクを入力..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleAddTodo}
              className="px-6 py-3 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-md hover:shadow-lg"
            >
              追加
            </button>
          </div>

          {/* Todoリスト */}
          <div className="space-y-2">
            {todos && todos.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                タスクがありません。上のフォームから追加してください！
              </div>
            ) : (
              todos?.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                >
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => handleToggleTodo(todo.id)}
                    className="w-5 h-5 text-blue-500 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span
                    className={\`flex-1 \${
                      todo.completed
                        ? "line-through text-gray-400"
                        : "text-gray-700"
                    }\`}
                  >
                    {todo.text}
                  </span>
                  <button
                    onClick={() => handleDeleteTodo(todo.id)}
                    className="px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                  >
                    削除
                  </button>
                </div>
              ))
            )}
          </div>

          {/* フッター */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-500">
            {todos && todos.length > 0 && (
              <p>
                {todos.filter((t) => !t.completed).length} 件の未完了タスク / 全 {todos.length} 件
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
`;

  fs.writeFileSync(path.join(srcDir, "App.tsx"), appTsx);

  // サーバー関数の型定義（クライアント側）
  // 実装は api/src/shared/server-functions.ts にあります
  const serverFns = `// サーバー関数の型定義
// SwallowKit が自動的に RPC 呼び出しに変換します
// 実際の実装は api/src/shared/server-functions.ts にあります

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export async function getTodos(): Promise<Todo[]> {
  // この関数は useServerFn によって RPC 呼び出しに自動変換されます
  throw new Error("This is a server function and should be called via useServerFn");
}

export async function addTodo({ text }: { text: string }): Promise<Todo> {
  throw new Error("This is a server function and should be called via useServerFn");
}

export async function deleteTodo({ id }: { id: string }): Promise<{ success: boolean }> {
  throw new Error("This is a server function and should be called via useServerFn");
}

export async function toggleTodo({ id }: { id: string }): Promise<Todo | null> {
  throw new Error("This is a server function and should be called via useServerFn");
}
`;

  fs.writeFileSync(path.join(srcDir, "serverFns.ts"), serverFns);

  // index.tsx
  const indexTsx = `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

  fs.writeFileSync(path.join(srcDir, "index.tsx"), indexTsx);

  // CSS with Tailwind directives
  const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

  fs.writeFileSync(path.join(srcDir, "index.css"), indexCss);

  // HTML template
  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${options.name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/index.tsx"></script>
</body>
</html>
`;

  fs.writeFileSync(path.join(projectDir, "index.html"), indexHtml);

  // Vite設定ファイル
  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['swallowkit'],
  },
});
`;

  fs.writeFileSync(path.join(projectDir, "vite.config.ts"), viteConfig);

  // Tailwind CSS設定
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;

  fs.writeFileSync(path.join(projectDir, "tailwind.config.js"), tailwindConfig);

  // PostCSS設定
  const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;

  fs.writeFileSync(path.join(projectDir, "postcss.config.js"), postcssConfig);

  // tsconfig.node.json (Vite設定用)
  const tsConfigNode = {
    compilerOptions: {
      composite: true,
      module: "ESNext",
      moduleResolution: "bundler",
      allowSyntheticDefaultImports: true,
    },
    include: ["vite.config.ts"],
  };

  fs.writeFileSync(
    path.join(projectDir, "tsconfig.node.json"),
    JSON.stringify(tsConfigNode, null, 2)
  );

  console.log("📁 プロジェクト構造を作成しました");
}
