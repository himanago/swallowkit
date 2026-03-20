import { toPascalCase, toCamelCase, toKebabCase } from "../core/scaffold/model-parser";

describe("toPascalCase", () => {
  it("converts kebab-case to PascalCase", () => {
    expect(toPascalCase("todo-item")).toBe("TodoItem");
  });

  it("converts snake_case to PascalCase", () => {
    expect(toPascalCase("todo_item")).toBe("TodoItem");
  });

  it("handles single word", () => {
    expect(toPascalCase("todo")).toBe("Todo");
  });

  it("handles already PascalCase (no separators)", () => {
    expect(toPascalCase("Todo")).toBe("Todo");
  });

  it("handles multiple segments", () => {
    expect(toPascalCase("my-cool-model")).toBe("MyCoolModel");
  });

  it("handles empty string", () => {
    expect(toPascalCase("")).toBe("");
  });
});

describe("toCamelCase", () => {
  it("converts kebab-case to camelCase", () => {
    expect(toCamelCase("todo-item")).toBe("todoItem");
  });

  it("converts snake_case to camelCase", () => {
    expect(toCamelCase("todo_item")).toBe("todoItem");
  });

  it("handles single word", () => {
    expect(toCamelCase("Todo")).toBe("todo");
  });

  it("handles PascalCase input (lowercases first char)", () => {
    expect(toCamelCase("TodoItem")).toBe("todoItem");
  });

  it("handles empty string", () => {
    expect(toCamelCase("")).toBe("");
  });
});

describe("toKebabCase", () => {
  it("converts PascalCase to kebab-case", () => {
    expect(toKebabCase("TodoItem")).toBe("todo-item");
  });

  it("converts camelCase to kebab-case", () => {
    expect(toKebabCase("todoItem")).toBe("todo-item");
  });

  it("handles single lowercase word", () => {
    expect(toKebabCase("todo")).toBe("todo");
  });

  it("handles multiple capitals", () => {
    expect(toKebabCase("MyCoolModel")).toBe("my-cool-model");
  });

  it("handles already kebab-case", () => {
    expect(toKebabCase("todo-item")).toBe("todo-item");
  });

  it("handles empty string", () => {
    expect(toKebabCase("")).toBe("");
  });
});
