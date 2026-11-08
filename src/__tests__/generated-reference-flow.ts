import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/** Runs generated React form -> managed BFF -> TS CRUD and auth; Cosmos bindings use an isolated in-memory store. */
export async function exerciseGeneratedReferenceFlow(root: string, sharedPackage: string): Promise<void> {
  const modules = new Map<string, any>();
  const registrations: Array<any> = [];
  const documents: Record<string, any[]> = {};
  const navigation = jest.fn();
  let hook = 0;
  const states: any[] = [];
  const effects: Array<() => void> = [];
  const load = (file: string): any => {
    const resolved = [file, `${file}.ts`, `${file}.tsx`, path.join(file, "index.ts")]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())!;
    if (!resolved) throw new Error(`Unresolved generated module: ${file}`);
    if (modules.has(resolved)) return modules.get(resolved);
    const module = { exports: {} as any };
    modules.set(resolved, module.exports);
    const requireGenerated = (name: string): any => {
      if (name === sharedPackage) return load(path.join(root, "shared", "index.ts"));
      if (name === "react") return {
        useState(initial: any) {
          const index = hook++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (next: any) => { states[index] = next; }];
        },
        useEffect(effect: () => void) { if (!effects.length) effects.push(effect); },
      };
      if (name === "react/jsx-runtime") return {
        jsx: (type: any, props: any) => ({ type, props }),
        jsxs: (type: any, props: any) => ({ type, props }),
      };
      if (name === "react-router-dom") return { useNavigate: () => navigation };
      if (name === "@azure/functions") return { app: { http: (_name: string, config: any) => registrations.push(config) } };
      if (name.startsWith(".")) return load(path.resolve(path.dirname(resolved), name));
      if (name.startsWith("@/")) return load(path.join(root, "src", name.slice(2)));
      return require(name);
    };
    const output = ts.transpileModule(fs.readFileSync(resolved, "utf-8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", output)(requireGenerated, module, module.exports);
    modules.set(resolved, module.exports);
    return module.exports;
  };
  const previousEnv = { base: process.env.BACKEND_FUNCTIONS_BASE_URL, key: process.env.BACKEND_FUNCTIONS_KEY };
  const realFetch = global.fetch;
  let roles = ["anonymous", "authenticated", "admin"];
  const bff: Record<string, any> = {};
  const fetches: string[] = [];
  try {
    process.env.BACKEND_FUNCTIONS_BASE_URL = "https://generated-backend.test";
    process.env.BACKEND_FUNCTIONS_KEY = "fixture-key";
    for (const name of ["grammar-topic", "sample-question"]) load(path.join(root, "functions", "src", `${name}.ts`));
    for (const name of ["grammarTopic", "sampleQuestion"]) {
      const config = JSON.parse(fs.readFileSync(path.join(root, "bff", name, "function.json"), "utf-8"));
      expect(config.bindings[0].route).toBe(`${name}/{id?}`);
      bff[`/api/${name}`] = load(path.join(root, "bff", "src", name, "index.ts")).default;
    }
    global.fetch = (async (url: string, init?: RequestInit) => {
      fetches.push(url);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/")) {
        const handler = bff[url];
        if (!handler) return new Response("{}", { status: 404 });
        const principal = Buffer.from(JSON.stringify({ identityProvider: "github", userId: "fixture", userDetails: "Fixture", userRoles: roles })).toString("base64");
        const result = await handler({}, { method, params: {}, headers: { "x-ms-client-principal": principal }, body: init?.body });
        return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
      }
      const route = new URL(url).pathname.replace(/^\/api\//, "");
      const registration = registrations.find(entry => entry.route === route && entry.methods.includes(method));
      if (!registration) return new Response("{}", { status: 404 });
      const container = registration.extraInputs?.[0]?.containerName ?? registration.extraOutputs?.[0]?.containerName;
      const result = await registration.handler({
        method, headers: new Headers(init?.headers), json: async () => JSON.parse(String(init?.body)),
      }, {
        log() {}, error() {},
        extraInputs: { get: () => documents[container] ?? [] },
        extraOutputs: { set: (_name: string, value: any) => { (documents[container] ??= []).push(value); } },
      });
      return new Response(JSON.stringify(result.jsonBody), { status: result.status });
    }) as typeof fetch;
    const topicResponse = await fetch("/api/grammarTopic", { method: "POST", body: JSON.stringify({ name: "Present tense" }) });
    expect(topicResponse.status).toBe(201);
    const topic = await topicResponse.json();
    const Form = load(path.join(root, "src", "pages", "sample-question", "_components", "SampleQuestionForm.tsx")).default;
    const render = () => { hook = 0; return Form({}); };
    const find = (tree: any, predicate: (node: any) => boolean): any => {
      if (!tree || typeof tree !== "object") return undefined;
      if (predicate(tree)) return tree;
      const children = [tree.props?.children].flat(Infinity);
      for (const child of children) { const match = find(child, predicate); if (match) return match; }
    };
    let tree = render();
    effects[0]();
    // Flush the generated option fetch promise chain.
    await new Promise(resolve => setImmediate(resolve));
    tree = render();
    const select = find(tree, node => node.type === "select" && node.props.id === "grammarTopicId");
    expect(find(select, node => node.type === "option" && node.props.value === topic.id)).toBeDefined();
    select.props.onChange({ target: { value: topic.id } });
    tree = render();
    const publication = { instructionJa: "説明", sourceIds: ["source-1"], provider: { name: "Provider" }, validation: { checked: true } };
    for (const [name, value] of Object.entries({ language: "it", prompt: "Question", publication: JSON.stringify(publication) })) {
      find(tree, node => node.props?.id === name).props.onChange({ target: { value } });
      tree = render();
    }
    await tree.props.onSubmit({ preventDefault() {} });
    expect(navigation).toHaveBeenCalledWith("/sample-question");
    const saved = await (await fetch("/api/sampleQuestion")).json();
    expect(saved).toEqual([expect.objectContaining({ grammarTopicId: topic.id, publication })]);
    expect(saved[0]).not.toHaveProperty("provider");
    expect(fetches).toContain("/api/grammarTopic");
    expect(fetches).not.toContain("/api/grammar-topic");
    roles = ["anonymous", "authenticated"];
    expect((await fetch("/api/grammarTopic")).status).toBe(403);
    expect((await fetch("/api/grammarTopic", { method: "POST", body: JSON.stringify({ name: "Forbidden" }) })).status).toBe(403);
    roles = ["anonymous"];
    expect((await fetch("/api/grammarTopic")).status).toBe(401);
  } finally {
    global.fetch = realFetch;
    if (previousEnv.base === undefined) delete process.env.BACKEND_FUNCTIONS_BASE_URL;
    else process.env.BACKEND_FUNCTIONS_BASE_URL = previousEnv.base;
    if (previousEnv.key === undefined) delete process.env.BACKEND_FUNCTIONS_KEY;
    else process.env.BACKEND_FUNCTIONS_KEY = previousEnv.key;
  }
}
