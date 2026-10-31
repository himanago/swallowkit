import { FieldInfo, ModelInfo, toCamelCase, toPascalCase } from "./model-parser";

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
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      minimum?: number;
      maximum?: number;
      exclusiveMinimum?: boolean;
      exclusiveMaximum?: boolean;
      minItems?: number;
      maxItems?: number;
    };

/**
 * Promote inline `z.object({...})` fields to named models (e.g. ProbeItem.nested -> ProbeItemNested)
 * so OpenAPI components and native classes keep their shape. Expanded fields reference the new model.
 */
export function expandInlineObjectModels(models: ModelInfo[]): ModelInfo[] {
  const names = new Set(models.map((model) => model.name));
  const synthetic: ModelInfo[] = [];

  const expand = (owner: ModelInfo): ModelInfo => ({
    ...owner,
    fields: owner.fields.map((field) => {
      if (!field.objectFields || field.isNestedSchema) return field;
      let name = `${owner.name}${toPascalCase(field.name)}`;
      while (names.has(name)) name = `${name}Object`;
      names.add(name);
      const nested = expand({
        ...owner,
        name,
        displayName: name,
        schemaName: name,
        fields: field.objectFields,
        hasId: field.objectFields.some((child) => child.name === "id"),
        hasCreatedAt: field.objectFields.some((child) => child.name === "createdAt"),
        hasUpdatedAt: field.objectFields.some((child) => child.name === "updatedAt"),
        nestedSchemaRefs: [],
        partitionKey: "/id",
        connectorConfig: undefined,
        authPolicy: undefined,
      });
      synthetic.push(nested);
      const rest = { ...field };
      delete rest.objectFields;
      return { ...rest, isNestedSchema: true, nestedModelName: name };
    }),
  });

  const expanded = models.map(expand);
  return [...expanded, ...synthetic];
}

function toScalarSchema(field: FieldInfo): OpenApiSchema {
  const constraints = field.constraints ?? {};
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
        ...(field.format && field.format !== "time" ? { format: field.format } : {}),
        ...(constraints.minLength !== undefined ? { minLength: constraints.minLength } : {}),
        ...(constraints.maxLength !== undefined ? { maxLength: constraints.maxLength } : {}),
        ...(constraints.pattern !== undefined ? { pattern: constraints.pattern } : {}),
      };
    case "date":
      return {
        type: "string",
        format: "date-time",
      };
    case "number":
      return {
        ...(field.isInteger ? { type: "integer", format: "int64" } : { type: "number", format: "double" }),
        ...(constraints.minimum !== undefined ? { minimum: constraints.minimum } : {}),
        ...(constraints.exclusiveMinimum ? { exclusiveMinimum: true } : {}),
        ...(constraints.maximum !== undefined ? { maximum: constraints.maximum } : {}),
        ...(constraints.exclusiveMaximum ? { exclusiveMaximum: true } : {}),
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
      ...(field.constraints?.minItems !== undefined ? { minItems: field.constraints.minItems } : {}),
      ...(field.constraints?.maxItems !== undefined ? { maxItems: field.constraints.maxItems } : {}),
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
    expandInlineObjectModels(models).map((model) => [model.name, createComponentSchema(model)])
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
