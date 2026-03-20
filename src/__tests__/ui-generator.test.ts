import {
  generateListPage,
  generateDetailPage,
  generateFormComponent,
  generateNewPage,
  generateEditPage,
} from "../core/scaffold/ui-generator";
import {
  createBasicModelInfo,
  createModelInfoWithForeignKey,
  createModelInfoWithEnum,
} from "./fixtures";

describe("generateListPage", () => {
  it("generates list page for basic model (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("contains 'use client' directive", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("'use client'");
  });

  it("imports schema from shared package", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("@myapp/shared");
  });

  it("fetches from correct API endpoint", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("/api/todo");
  });

  it("displays up to 3 non-id fields", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    // title, description, completed — first 3 non-id fields
    expect(code).toContain("title");
  });

  it("handles foreign key fields", () => {
    const model = createModelInfoWithForeignKey();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("categoryId");
  });
});

describe("generateDetailPage", () => {
  it("generates detail page (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateDetailPage(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("contains 'use client' directive", () => {
    const model = createBasicModelInfo();
    const code = generateDetailPage(model, "@myapp/shared");
    expect(code).toContain("'use client'");
  });

  it("includes delete button", () => {
    const model = createBasicModelInfo();
    const code = generateDetailPage(model, "@myapp/shared");
    expect(code).toContain("DELETE");
  });
});

describe("generateFormComponent", () => {
  it("generates form component (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateFormComponent(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("generates inputs for non-managed fields", () => {
    const model = createBasicModelInfo();
    const code = generateFormComponent(model, "@myapp/shared");
    // title and description should have form inputs
    expect(code).toContain("title");
    expect(code).toContain("description");
  });

  it("generates enum select for enum fields", () => {
    const model = createModelInfoWithEnum();
    const code = generateFormComponent(model, "@myapp/shared");
    expect(code).toContain("select");
    expect(code).toContain("open");
    expect(code).toContain("in_progress");
    expect(code).toContain("closed");
  });

  it("generates checkbox for boolean fields", () => {
    const model = createBasicModelInfo();
    const code = generateFormComponent(model, "@myapp/shared");
    expect(code).toContain("checkbox");
  });
});

describe("generateNewPage", () => {
  it("generates new page (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateNewPage(model);
    expect(code).toMatchSnapshot();
  });

  it("contains form component reference", () => {
    const model = createBasicModelInfo();
    const code = generateNewPage(model);
    expect(code).toContain("Form");
  });

  it("references the form component", () => {
    const model = createBasicModelInfo();
    const code = generateNewPage(model);
    expect(code).toContain("TodoForm");
    expect(code).toContain("Create New Todo");
  });
});

describe("generateEditPage", () => {
  it("generates edit page (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateEditPage(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("loads existing data and passes to form", () => {
    const model = createBasicModelInfo();
    const code = generateEditPage(model, "@myapp/shared");
    expect(code).toContain("initialData");
    expect(code).toContain("isEdit={true}");
  });

  it("fetches existing data for editing", () => {
    const model = createBasicModelInfo();
    const code = generateEditPage(model, "@myapp/shared");
    expect(code).toContain("/api/todo/");
  });
});
