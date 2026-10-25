import { ModelInfo, toKebabCase } from "./model-parser";
import { UIAuthOptions } from "./ui-generator";

/** Adapt the shared CRUD presentation templates to React Router, without a Next.js runtime. */
export function adaptReactPage(source: string): string {
  return source
    .replace(/^'use client';?\s*\r?\n/, "")
    .replace(
      /import Link from 'next\/link';/g,
      "import { Link } from 'react-router-dom';"
    )
    .replace(
      /import \{ useParams, useRouter \} from 'next\/navigation';/g,
      "import { useParams, useNavigate } from 'react-router-dom';"
    )
    .replace(
      /import \{ useRouter \} from 'next\/navigation';/g,
      "import { useNavigate } from 'react-router-dom';"
    )
    .replace(/\buseRouter\(\)/g, "useNavigate()")
    .replace(/\brouter\.(?:push|replace)\(/g, "router(")
    .replace(/^\s*router\.refresh\(\);?\s*$/gm, "")
    .replace(/(<Link\b[^>]*?)\bhref=/gs, "$1to=")
    .replace(/\[params\]/g, "[params.id]");
}

export function generateReactModelRoutes(
  model: ModelInfo,
  auth?: UIAuthOptions
): string {
  const slug = toKebabCase(model.name);
  return `import type { RouteObject } from 'react-router-dom';
${auth ? "import { Outlet } from 'react-router-dom';\nimport Layout from './layout';" : ""}
import List from './page';
import Detail from './[id]/page';
import New from './new/page';
import Edit from './[id]/edit/page';

const routes: RouteObject[] = [{
  path: '/${slug}',
  ${auth ? "element: <Layout><Outlet /></Layout>," : ""}
  children: [
    { index: true, element: <List /> },
    { path: 'new', element: <New /> },
    { path: ':id', element: <Detail /> },
    { path: ':id/edit', element: <Edit /> },
  ],
}];
export default routes;
`;
}
