import * as fs from "fs";
import * as path from "path";
import { BackendLanguage } from "../../types";
import {
  PackageManager,
  getCommands,
  getCiSetupStep,
  getAzurePipelinesSetup,
} from "../../utils/package-manager";
import {
  generateManagedFunctionConfig,
  generateReactBffHelper,
  generateReactGreetBff,
} from "../scaffold/react-bff-generator";

function write(
  projectDir: string,
  relativePath: string,
  content: string
): void {
  const destination = path.join(projectDir, ...relativePath.split(/[\\/]/));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

export function buildReactSwaConfig() {
  return {
    platform: { apiRuntime: "node:20" },
    navigationFallback: {
      rewrite: "/index.html",
      exclude: [
        "/api/*",
        "/.auth/*",
        "/assets/*",
        "/*.{css,js,json,ico,png,svg,txt}",
      ],
    },
    routes: [{ route: "/*", allowedRoles: ["anonymous"] }],
    globalHeaders: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  };
}

export function createReactProject(
  projectDir: string,
  projectName: string
): void {
  write(
    projectDir,
    "package.json",
    JSON.stringify(
      {
        name: projectName,
        version: "0.1.0",
        private: true,
        scripts: { dev: "vite --port 3000", preview: "vite preview" },
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "react-router-dom": "^7.0.0",
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@vitejs/plugin-react": "^5.0.0",
          vite: "^7.0.0",
          typescript: "^5.9.0",
          tailwindcss: "^4.0.0",
          "@tailwindcss/vite": "^4.0.0",
          "@azure/static-web-apps-cli": "^2.0.0",
        },
      },
      null,
      2
    )
  );
  write(
    projectDir,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          paths: { "@/*": ["./*"] },
          types: ["vite/client"],
        },
        include: ["src", "lib"],
        exclude: ["node_modules", "functions", "bff", "shared", "dist"],
      },
      null,
      2
    )
  );
  write(
    projectDir,
    "vite.config.mts",
    `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: {
    '@': fileURLToPath(new URL('.', import.meta.url)),
    '@${projectName}/shared': fileURLToPath(new URL('./shared/index.ts', import.meta.url)),
  } },
  server: { port: 3000, strictPort: true },
  build: { outDir: 'dist' },
});
`
  );
  write(
    projectDir,
    "index.html",
    `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>SwallowKit</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`
  );
  write(
    projectDir,
    "src\\main.tsx",
    `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
`
  );
  write(
    projectDir,
    "src\\App.tsx",
    `import { useRoutes, type RouteObject } from 'react-router-dom';
import Home from './Home';

const modules = import.meta.glob<RouteObject[]>('./pages/**/routes.tsx', { eager: true, import: 'default' });
const pages = import.meta.glob<{ default: React.ComponentType }>('./pages/login.tsx', { eager: true });
const Login = pages['./pages/login.tsx']?.default;

export default function App() {
  return useRoutes([
    { path: '/', element: <Home /> },
    ...(Login ? [{ path: '/login', element: <Login /> }] : []),
    ...Object.values(modules).flat(),
    { path: '*', element: <main>Page not found</main> },
  ]);
}
`
  );
  write(
    projectDir,
    "src\\Home.tsx",
    `import { useState } from 'react';
import { Link } from 'react-router-dom';
import { scaffoldConfig } from '@/lib/scaffold-config';

export default function Home() {
  const [message, setMessage] = useState('');
  async function testConnection() {
    try {
      const response = await fetch('/api/greet?name=SwallowKit');
      if (!response.ok) throw new Error('BFF request failed (' + response.status + ')');
      const data = await response.json();
      setMessage(data.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  return <main className="container mx-auto p-8">
    <h1 className="text-3xl font-bold mb-4">SwallowKit + React</h1>
    <p>React SPA → SWA managed Functions BFF → standalone Functions → Cosmos DB</p>
    <button className="my-4 bg-blue-600 text-white rounded px-4 py-2" onClick={testConnection}>Test backend connection</button>
    <p role="status">{message}</p>
    <nav>{scaffoldConfig.models.map(model => <p key={model.name}><Link to={model.path}>{model.label}</Link></p>)}</nav>
  </main>;
}
`
  );
  write(projectDir, "src\\style.css", '@import "tailwindcss";\n');
  write(
    projectDir,
    "lib\\scaffold-config.ts",
    `export interface ScaffoldModel { name: string; path: string; label: string; }
export const scaffoldConfig = {
  models: [] as ScaffoldModel[]
};
`
  );
  write(
    projectDir,
    ".gitignore",
    "node_modules/\ndist/\n.env*.local\nlocal.settings.json\n"
  );
}

export function createReactBffProject(
  projectDir: string,
  projectName: string,
  pm: PackageManager
): void {
  write(
    projectDir,
    "bff\\package.json",
    JSON.stringify(
      {
        name: "bff",
        private: true,
        version: "1.0.0",
        description:
          "SWA managed HTTP-only Functions BFF (not the standalone backend)",
        engines: { node: ">=20" },
        scripts: {
          build: "tsc --noEmit && node build.cjs",
          start: "func start --port 7073",
          prestart: `${pm} run build`,
        },
        devDependencies: {
          "@azure/functions": "^3.5.0",
          "@types/node": "^22.0.0",
          typescript: "^5.9.0",
          esbuild: "^0.25.0",
          [`@${projectName}/shared`]:
            pm === "pnpm" ? "workspace:*" : "file:../shared",
          zod: "^4.0.0",
        },
      },
      null,
      2
    )
  );
  write(projectDir, "bff\\build.cjs", buildReactBffBuildSource());
  write(
    projectDir,
    "bff\\tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM"],
          module: "Node16",
          moduleResolution: "Node16",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2
    )
  );
  // Classic function.json registrations work with SWA's managed Functions runtime.
  write(
    projectDir,
    "bff\\host.json",
    JSON.stringify(
      { version: "2.0", extensions: { http: { routePrefix: "api" } } },
      null,
      2
    )
  );
  write(
    projectDir,
    "bff\\local.settings.json",
    JSON.stringify(
      {
        IsEncrypted: false,
        Values: {
          FUNCTIONS_WORKER_RUNTIME: "node",
          BACKEND_FUNCTIONS_BASE_URL: "http://localhost:7071",
          BACKEND_FUNCTIONS_KEY: "",
        },
        Host: { LocalHttpPort: 7073, CORS: "http://localhost:4280" },
      },
      null,
      2
    )
  );
  write(
    projectDir,
    "bff\\.gitignore",
    "node_modules/\ndist/\nlocal.settings.json\n"
  );
  write(
    projectDir,
    "bff\\.funcignore",
    "src/\nnode_modules/\nlocal.settings.json\ntsconfig.json\nbuild.cjs\n.gitignore\n"
  );
  write(
    projectDir,
    "bff\\src\\lib\\call-function.ts",
    generateReactBffHelper(projectName)
  );
  write(projectDir, "bff\\src\\greet\\index.ts", generateReactGreetBff());
  write(
    projectDir,
    "bff\\greet\\function.json",
    generateManagedFunctionConfig("greet", ["GET", "POST"], "greet")
  );
}

export function buildReactBffBuildSource(): string {
  return `const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const entryPoints = fs.readdirSync(path.join(__dirname, 'src'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(__dirname, 'src', entry.name, 'index.ts')))
  .map(entry => path.join('src', entry.name, 'index.ts'));
if (!entryPoints.length) throw new Error('No managed BFF handlers found');
buildSync({
  absWorkingDir: __dirname, entryPoints, bundle: true,
  platform: 'node', target: 'node20', outbase: 'src', outdir: 'dist', logLevel: 'info',
});
for (const entry of entryPoints) {
  const output = path.join(__dirname, 'dist', path.basename(path.dirname(entry)), 'index.js');
  if (!fs.existsSync(output)) throw new Error('Missing managed BFF bundle: ' + output);
}
`;
}

export function buildReactReadme(
  projectName: string,
  pm: PackageManager,
  backend: BackendLanguage
): string {
  const cmd = getCommands(pm);
  return `# ${projectName}

Generated by SwallowKit: React + Vite + TypeScript on Azure Static Web Apps.

## Architecture

Browser → React SPA → /api (SWA managed Functions BFF) → standalone ${backend} Functions → Cosmos DB.

- \`src/\`: React Router UI. No Next.js runtime.
- \`bff/\`: HTTP-only SWA managed Functions. Validates shared schemas and forwards requests; no database/business logic.
- \`functions/\`: independently deployed backend, NOT linked to SWA.
- \`shared/models/\`: Zod source of truth.
- \`infra/\`: Bicep infrastructure.

Only the BFF reads BACKEND_FUNCTIONS_BASE_URL and BACKEND_FUNCTIONS_KEY.
Never put those values in VITE_* variables or client code.

## Develop

\`\`\`sh
${cmd.exec} swallowkit create-model todo
${cmd.exec} swallowkit scaffold todo
${cmd.exec} swallowkit dev
\`\`\`

Use http://localhost:4280, not Vite's direct port, for same-origin UI/BFF requests.
Dev starts Vite (3000), the managed BFF (7073), the standalone Functions (7071),
and SWA CLI (4280). \`--bff-port\`, \`--port\`, \`--functions-port\`, and \`--swa-port\` override ports.
The BFF stays separate even with \`--no-functions\`; \`--no-swa\` starts only the
direct Vite/BFF servers (no same-origin API routing or SWA authentication).
Core Tools v4 must already be available. Start Cosmos DB Emulator manually if
this application needs Cosmos; SwallowKit never starts it.

Local BFF settings live in \`bff/local.settings.json\` (gitignored). Backend settings
live in \`functions/local.settings.json\`. Keep their secrets out of source control.
\`--mock-connectors\` still routes through the BFF and mocks only connector data.

## Verify

\`\`\`sh
${pm} run build
${cmd.exec} swallowkit machine verify project
${cmd.exec} swallowkit machine verify project --checks structure,drift,typecheck,build
\`\`\`

The build compiles shared schemas, checks the SPA, builds static assets, and
typechecks/bundles the managed BFF. Exercise CRUD and authentication through
the SWA port as well; structural verification is not an end-to-end test.

## Deploy

Use the generated GitHub Actions / Azure Pipelines workflows when selected.
Deploy \`dist/\` as the static app and \`bff/\` as its managed API, with
\`skip_app_build: true\` and \`skip_api_build: true\` after \`${pm} run build\`.
BFF bundles include shared schemas and Zod, so no workspace install is needed
in SWA's API build. Deploy \`functions/\` independently, never as SWA's api_location.
Do NOT link the standalone Functions app to SWA.

After approved provisioning and backend deployment, apply the generated SWA
appsettings module with the backend URL/key. The key is required for remote
Functions calls, and stays server-side. SPA deep links use navigationFallback;
/api and /.auth are excluded so missing APIs never become index.html.

See AGENTS.md for ownership, plan/apply, authentication, and verification guidance.
`;
}

const REACT_DEPLOY_PATHS = [
  "src/**",
  "bff/**",
  "lib/**",
  "shared/**",
  "public/**",
  "index.html",
  "vite.config.mts",
  "tsconfig.json",
  "staticwebapp.config.json",
  "package.json",
  "pnpm-workspace.yaml",
];

export function buildReactGitHubSwaWorkflow(pm: PackageManager): string {
  const paths = [
    ...REACT_DEPLOY_PATHS,
    pm === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json",
    ".github/workflows/deploy-swa.yml",
  ];
  return `name: Deploy React SPA and managed BFF
on:
  push:
    branches: [main]
    paths:
${paths.map((entry) => `      - '${entry}'`).join("\n")}
  pull_request:
    branches: [main]
    paths:
${paths.map((entry) => `      - '${entry}'`).join("\n")}
  workflow_dispatch:
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${getCiSetupStep(pm)}
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: ${pm}
      - name: Build SPA and managed BFF
        run: |
          ${getCommands(pm).ci}
          ${pm} run build
      - name: Deploy SPA and managed BFF (standalone Functions are NOT linked)
        if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: \${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: \${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: dist
          api_location: bff
          output_location: ''
          skip_app_build: true
          skip_api_build: true
`;
}

export function buildReactAzureSwaPipeline(pm: PackageManager): string {
  return `trigger:
  branches:
    include: [main]
  paths:
    include:
${[...REACT_DEPLOY_PATHS, pm === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json", "pipelines/swa.yml"].map((entry) => `      - '${entry}'`).join("\n")}
pr:
  branches:
    include: [main]
pool:
  vmImage: ubuntu-latest
variables:
  - group: azure-deployment
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
${getAzurePipelinesSetup(pm)}
  - script: |
      ${getCommands(pm).ci}
      ${pm} run build
    displayName: Build React SPA and managed BFF
  - task: AzureStaticWebApp@0
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      app_location: dist
      api_location: bff
      output_location: ''
      skip_app_build: true
      skip_api_build: true
      azure_static_web_apps_api_token: $(AZURE_STATIC_WEB_APPS_API_TOKEN)
    displayName: Deploy SPA and managed BFF (standalone Functions are NOT linked)
`;
}
