import * as fs from "fs";
import * as path from "path";
import { parseModelFile } from "../core/scaffold/model-parser";
import { generateOpenApiDocument } from "../core/scaffold/openapi-generator";
import {
  FileOperationSession,
  runWithFileSession,
} from "../core/operations/file-session";
import { generateFormComponent } from "../core/scaffold/ui-generator";

describe("nested imported scaffold schemas", () => {
  describe.each(["zod", "zod/v4"])(
    "%s existing entity selectors",
    (zodImport) => {
      it.each([
        ["ImportedCategory", false],
        ["ImportedCategory.optional().nullable()", false],
        ["z.array(ImportedCategory)", true],
        ["z.array(ImportedCategory).min(1).max(3).optional()", true],
        ["z.array(ImportedCategory).nonempty().nullable()", true],
        ["ImportedCategory.array().min(1).optional()", true],
      ])(
        "keeps existing entity selectors for %s",
        async (expression, isArray) => {
          const root = fs.mkdtempSync(
            path.join(process.cwd(), ".tmp-existing-reference-")
          );
          try {
            fs.writeFileSync(
              path.join(root, "category.ts"),
              `import { z } from '${zodImport}';
export const categorySchema = z.object({ id: z.string(), name: z.string() });`
            );
            const file = path.join(root, "record.ts");
            fs.writeFileSync(
              file,
              `import { z } from '${zodImport}';
import { categorySchema as ImportedCategory } from './category';
export const Record = z.object({ id: z.string(), link: ${expression} });`
            );
            const model = await parseModelFile(file);
            expect(model.nestedSchemaRefs).toEqual([
              expect.objectContaining({
                fieldName: "link",
                schemaName: "categorySchema",
                modelName: "Category",
                isArray,
              }),
            ]);
            expect(model.fields[1]).toMatchObject({
              isNestedSchema: true,
              nestedModelName: "Category",
              isArray,
            });
            const form = generateFormComponent(model, "@fixture/shared");
            expect(form).toContain("fetch('/api/category')");
            expect(form).toContain(
              isArray ? "value={formData.linkIds}" : "value={formData.linkId}"
            );
            expect(form).not.toContain("JSON.parse(submitData.link)");
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        }
      );
    }
  );

  it.each(["zod", "zod/v4"])(
    "preserves inline and local shapes with %s",
    async (zodImport) => {
      const root = fs.mkdtempSync(
        path.join(process.cwd(), ".tmp-nested-imports-")
      );
      try {
        fs.writeFileSync(
          path.join(root, "common.ts"),
          `import { z } from '${zodImport}';
export const Unrelated = z.object({ ignored: z.boolean() });
export const ProviderInfo = z.object({ name: z.string().min(1), url: z.string().nullable() });
export const QuestionValidation = z.object({ checked: z.boolean(), notes: z.array(z.string()).optional() });
`
        );
        const publication = `z.object({
        instructionJa: z.string().min(1), sourceIds: z.array(z.string()).min(1),
        provider: ProviderInfo, validation: Validation.nullable().optional(),
        providers: z.array(ProviderInfo).nullable().optional(),
      })`;
        const modelPath = path.join(root, "sample-question.ts");
        const source = (
          local: boolean,
          dynamic = false
        ) => `import { z } from '${zodImport}';
import { ProviderInfo, QuestionValidation as Validation } from './common';
${local ? `const QuestionPublication = ${publication};` : ""}
${dynamic ? "const idFields = { id: z.string() };" : ""}
export const SampleQuestion = z.object({
  ${dynamic ? "...idFields" : "id: z.string()"}, language: z.enum(['it', 'en']),
  publication: ${local ? "QuestionPublication" : publication}.optional().nullable(),
  publications: z.array(${local ? "QuestionPublication" : publication}).optional(),
});
export const partitionKey = '/language';
`;
        fs.writeFileSync(modelPath, source(false));
        const session = new FileOperationSession("collect");
        const inline = await runWithFileSession(session, () =>
          parseModelFile(modelPath)
        );
        expect(inline.fields.map((field) => field.name)).toEqual([
          "id",
          "language",
          "publication",
          "publications",
        ]);
        expect(inline.nestedSchemaRefs).toEqual([]);
        expect(inline.fields[2]).toMatchObject({
          isOptional: true,
          isNullable: true,
          objectFields: [
            { name: "instructionJa" },
            { name: "sourceIds" },
            {
              name: "provider",
              objectFields: [
                { name: "name" },
                { name: "url", isNullable: true },
              ],
            },
            {
              name: "validation",
              isOptional: true,
              isNullable: true,
              objectFields: [{ name: "checked" }, { name: "notes" }],
            },
            {
              name: "providers",
              isArray: true,
              isOptional: true,
              isNullable: true,
            },
          ],
        });
        expect(
          Object.keys(session.inputFingerprints).some((file) =>
            file.endsWith("common.ts")
          )
        ).toBe(true);
        fs.writeFileSync(modelPath, source(true));
        const local = await parseModelFile(modelPath);
        expect(local.fields).toEqual(inline.fields);
        expect(local.semanticFingerprint).toBe(inline.semanticFingerprint);
        expect(generateOpenApiDocument([local], local)).toBe(
          generateOpenApiDocument([inline], inline)
        );
        const document = JSON.parse(generateOpenApiDocument([inline], inline));
        const components = document.components.schemas;
        expect(components.SampleQuestion.properties).not.toHaveProperty(
          "provider"
        );
        expect(
          components.SampleQuestionPublication.properties.provider.$ref
        ).toBe("#/components/schemas/SampleQuestionPublicationProvider");
        expect(
          components.SampleQuestionPublicationProvider.properties.name.minLength
        ).toBe(1);
        expect(components.SampleQuestion.properties.publication.nullable).toBe(
          true
        );
        expect(
          components.SampleQuestion.properties.publications.items.$ref
        ).toBe("#/components/schemas/SampleQuestionPublications");
        // The runtime fallback must retain the same child shape as the static path.
        fs.writeFileSync(modelPath, source(false, true));
        const dynamic = await parseModelFile(modelPath);
        expect(dynamic.parserMode).toBe("dynamic");
        expect(dynamic.fields).toEqual(inline.fields);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
