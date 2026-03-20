import { generateOpenApiDocument } from "../core/scaffold/openapi-generator";
import { createBasicModelInfo } from "./fixtures";

describe("generateOpenApiDocument", () => {
  it("emits an OpenAPI document for the root model", () => {
    const model = createBasicModelInfo();
    const document = JSON.parse(generateOpenApiDocument([model], model));

    expect(document.openapi).toBe("3.0.3");
    expect(document.components.schemas.Todo.properties.title.type).toBe("string");
    expect(document.paths["/api/todo"].post.requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/Todo");
  });

  it("emits nested schema references when present", () => {
    const todo = createBasicModelInfo({
      fields: [
        { name: "id", type: "string", isOptional: false, isArray: false },
        { name: "title", type: "string", isOptional: false, isArray: false },
        {
          name: "category",
          type: "object",
          isOptional: false,
          isArray: false,
          isNestedSchema: true,
          nestedModelName: "Category",
        },
      ],
    });
    const category = createBasicModelInfo({
      name: "Category",
      schemaName: "categorySchema",
      fields: [
        { name: "id", type: "string", isOptional: false, isArray: false },
        { name: "name", type: "string", isOptional: false, isArray: false },
      ],
    });

    const document = JSON.parse(generateOpenApiDocument([todo, category], todo));
    expect(document.components.schemas.Todo.properties.category.$ref).toBe("#/components/schemas/Category");
    expect(document.components.schemas.Category.properties.name.type).toBe("string");
  });
});
