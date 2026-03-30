/**
 * Zod モックデータジェネレーターのテスト
 */

import { generateMockDocument, generateMockDocuments } from "../core/mock/zod-mock-generator";
import {
  createBasicModelInfo,
  createRdbConnectorModelInfo,
  createApiConnectorModelInfo,
  createModelInfoWithEnum,
} from "./fixtures";

describe("generateMockDocument", () => {
  it("generates a document with all model fields", () => {
    const model = createBasicModelInfo();
    const doc = generateMockDocument(model, 1);

    expect(doc).toHaveProperty("id");
    expect(doc).toHaveProperty("title");
    expect(doc).toHaveProperty("description");
    expect(doc).toHaveProperty("completed");
    expect(doc).toHaveProperty("createdAt");
    expect(doc).toHaveProperty("updatedAt");
  });

  it("generates id using model name and index", () => {
    const model = createBasicModelInfo();
    const doc = generateMockDocument(model, 1);
    expect(doc.id).toBe("todo-001");
  });

  it("generates different values for different indices", () => {
    const model = createBasicModelInfo();
    const doc1 = generateMockDocument(model, 1);
    const doc2 = generateMockDocument(model, 2);
    expect(doc1.id).not.toBe(doc2.id);
    expect(doc1.title).not.toBe(doc2.title);
  });

  it("generates boolean fields with alternating values", () => {
    const model = createBasicModelInfo();
    const doc1 = generateMockDocument(model, 1);
    const doc2 = generateMockDocument(model, 2);
    expect(typeof doc1.completed).toBe("boolean");
    expect(doc1.completed).not.toBe(doc2.completed);
  });

  it("generates ISO date strings for *At fields", () => {
    const model = createBasicModelInfo();
    const doc = generateMockDocument(model, 1);
    expect(typeof doc.createdAt).toBe("string");
    // Should be parseable as ISO date
    expect(new Date(doc.createdAt as string).toISOString()).toBe(doc.createdAt);
  });

  it("generates string values for title fields", () => {
    const model = createBasicModelInfo();
    const doc = generateMockDocument(model, 1);
    expect(typeof doc.title).toBe("string");
    expect(doc.title).toContain("1");
  });

  it("handles optional string fields", () => {
    const model = createBasicModelInfo();
    const doc = generateMockDocument(model, 1);
    // description is optional but still gets a value for mock data
    expect(typeof doc.description).toBe("string");
  });

  it("generates email-like values for email fields", () => {
    const model = createRdbConnectorModelInfo();
    const doc = generateMockDocument(model, 1);
    expect(doc.email).toContain("@example.com");
  });

  it("generates department values for department fields", () => {
    const model = createRdbConnectorModelInfo();
    const doc = generateMockDocument(model, 1);
    expect(typeof doc.department).toBe("string");
    // Should be one of the department names
    expect(["Engineering", "Sales", "Marketing", "Support", "HR"]).toContain(doc.department);
  });

  it("cycles enum values across indices", () => {
    const model = createModelInfoWithEnum();
    const doc1 = generateMockDocument(model, 1);
    const doc2 = generateMockDocument(model, 2);
    const doc3 = generateMockDocument(model, 3);
    expect(doc1.status).toBe("open");
    expect(doc2.status).toBe("in_progress");
    expect(doc3.status).toBe("closed");
  });

  it("generates foreign key references for *Id fields", () => {
    const model = createApiConnectorModelInfo();
    const doc = generateMockDocument(model, 1);
    expect(typeof doc.projectId).toBe("string");
    expect(doc.projectId).toContain("project-");
  });
});

describe("generateMockDocuments", () => {
  it("generates the specified number of documents", () => {
    const model = createBasicModelInfo();
    const docs = generateMockDocuments(model, 3);
    expect(docs).toHaveLength(3);
  });

  it("defaults to 5 documents", () => {
    const model = createBasicModelInfo();
    const docs = generateMockDocuments(model);
    expect(docs).toHaveLength(5);
  });

  it("generates unique ids for each document", () => {
    const model = createBasicModelInfo();
    const docs = generateMockDocuments(model, 5);
    const ids = docs.map((d) => d.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(5);
  });

  it("works with connector models", () => {
    const model = createRdbConnectorModelInfo();
    const docs = generateMockDocuments(model, 3);
    expect(docs).toHaveLength(3);
    // All should have email fields with @example.com
    for (const doc of docs) {
      expect(doc.email).toContain("@example.com");
    }
  });
});
