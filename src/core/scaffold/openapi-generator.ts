import { FieldInfo, ModelInfo, toCamelCase } from "./model-parser";

type OpenApiSchema =
  | {
      type?: string;
      format?: string;
      enum?: string[];
      items?: OpenApiSchema;
      properties?: Record<string, OpenApiSchema>;
      required?: string[];
      additionalProperties?: boolean;
      nullable?: boolean;
      $ref?: string;
    };

function toScalarSchema(field: FieldInfo): OpenApiSchema {
  if (field.enumValues?.length) {
    return {
      type: "string",
      enum: field.enumValues,
    };
  }

  switch (field.type) {
    case "string":
      return {
        type: "string",
        format: field.name.toLowerCase().endsWith("at") ? "date-time" : undefined,
      };
    case "date":
      return {
        type: "string",
        format: "date-time",
      };
    case "number":
      return {
        type: "number",
      };
    case "boolean":
      return {
        type: "boolean",
      };
    default:
      return {
        type: "object",
        additionalProperties: true,
      };
  }
}

function toFieldSchema(field: FieldInfo): OpenApiSchema {
  const schema = field.isNestedSchema && field.nestedModelName
    ? {
        $ref: `#/components/schemas/${field.nestedModelName}`,
      }
    : toScalarSchema(field);

  if (field.isArray) {
    return {
      type: "array",
      items: schema,
    };
  }

  return schema;
}

function createComponentSchema(model: ModelInfo): OpenApiSchema {
  const properties: Record<string, OpenApiSchema> = {};
  const required: string[] = [];

  for (const field of model.fields) {
    properties[field.name] = toFieldSchema(field);
    if (!field.isOptional) {
      required.push(field.name);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

export function generateOpenApiDocument(models: ModelInfo[], rootModel: ModelInfo): string {
  const rootModelRoute = toCamelCase(rootModel.name);
  const components = Object.fromEntries(
    models.map((model) => [model.name, createComponentSchema(model)])
  );

  const document = {
    openapi: "3.0.3",
    info: {
      title: `${rootModel.name} API`,
      version: "1.0.0",
      description: "Generated from SwallowKit Zod model metadata.",
    },
    paths: {
      [`/api/${rootModelRoute}`]: {
        get: {
          operationId: `${rootModelRoute}GetAll`,
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: `#/components/schemas/${rootModel.name}`,
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: `${rootModelRoute}Create`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${rootModel.name}`,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created response",
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${rootModel.name}`,
                  },
                },
              },
            },
          },
        },
      },
      [`/api/${rootModelRoute}/{id}`]: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        get: {
          operationId: `${rootModelRoute}GetById`,
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${rootModel.name}`,
                  },
                },
              },
            },
          },
        },
        put: {
          operationId: `${rootModelRoute}Update`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${rootModel.name}`,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated response",
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${rootModel.name}`,
                  },
                },
              },
            },
          },
        },
        delete: {
          operationId: `${rootModelRoute}Delete`,
          responses: {
            "204": {
              description: "Deleted response",
            },
          },
        },
      },
    },
    components: {
      schemas: components,
    },
  };

  return JSON.stringify(document, null, 2);
}
