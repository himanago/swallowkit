import { buildHomePage } from "../core/project/home-page";
import { adaptReactPage } from "../core/scaffold/react-ui-generator";

describe("shared home page presentation", () => {
  it.each(["npm", "pnpm"] as const)(
    "differs only in framework label and routing with %s",
    (pm) => {
      const next = buildHomePage("nextjs", pm);
      const react = buildHomePage("react", pm);
      const adaptedNext = adaptReactPage(next)
        .replace("export const dynamic = 'force-dynamic';\n\n", "")
        .replace("Next.js on Azure", "React on Azure");

      expect(react).toBe(adaptedNext);
      expect(react).toContain("Welcome to SwallowKit");
      expect(react).toContain("Your Models");
      expect(react).toContain("Get Started");
      expect(react).toContain("Built with SwallowKit");
      expect(react).toContain(
        `${pm === "npm" ? "npx" : "pnpm exec"} swallowkit scaffold shared/models/your-model.ts`
      );
    }
  );

  it("keeps Next.js-only directives out of the SPA", () => {
    const next = buildHomePage("nextjs", "pnpm");
    const react = buildHomePage("react", "pnpm");

    expect(next).toContain("'use client'");
    expect(next).toContain("export const dynamic = 'force-dynamic'");
    expect(next).toContain("href={model.path}");
    expect(react).not.toMatch(/next\/|use client|force-dynamic/);
    expect(react).toContain("import { Link } from 'react-router-dom'");
    expect(react).toContain("to={model.path}");
  });

  it.each(["nextjs", "react"] as const)(
    "preserves connection states and same-origin requests for %s",
    (frontend) => {
      const source = buildHomePage(frontend, "pnpm");
      expect(source).toContain("fetch('/api/greet?name=SwallowKit')");
      expect(source).toContain("disabled={greetingStatus === 'loading'}");
      expect(source).toContain("setGreetingStatus('success')");
      expect(source).toContain("setGreetingStatus('error')");
      expect(source).toContain('role="status"');
      expect(source).toContain('role="alert"');
      expect(source).not.toMatch(/BACKEND_FUNCTIONS_|VITE_/);
    }
  );
});
