import * as path from "path";
import { ModelInfo } from "../scaffold/model-parser";
import { buildProjectManifest, SWALLOWKIT_MANIFEST_PATH } from "../project/manifest";
import { recordSessionOperations } from "../project/artifacts";
import { FileOperationSession } from "./file-session";

function isProjectManifestCurrent(content: string, generated: object): boolean {
  let existing: unknown;
  try {
    existing = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;

  const existingWithoutTimestamp: Record<string, unknown> = { ...existing };
  const generatedWithoutTimestamp: Record<string, unknown> = { ...generated };
  delete existingWithoutTimestamp.generatedAt;
  delete generatedWithoutTimestamp.generatedAt;
  return JSON.stringify(existingWithoutTimestamp) === JSON.stringify(generatedWithoutTimestamp);
}

export async function stageModelMetadata(
  session: FileOperationSession,
  models: ModelInfo[],
  generator: string
): Promise<void> {
  const { manifest } = await buildProjectManifest(session.rootDirectory, models);
  const sharedModelsModule = manifest.modules.find(module => module.name === "shared-models");
  if (sharedModelsModule && session.operations.some(operation => operation.path.startsWith("shared/models/"))) {
    sharedModelsModule.exists = true;
  }
  const manifestPath = path.join(session.rootDirectory, SWALLOWKIT_MANIFEST_PATH);
  const existingContent = session.fileExists(manifestPath) ? session.readFile(manifestPath) : null;
  const content = existingContent && isProjectManifestCurrent(existingContent, manifest)
    ? existingContent
    : `${JSON.stringify({ ...manifest, generatedAt: session.generatedAt }, null, 2)}\n`;

  session.writeFile(manifestPath, content, {
    ownership: "metadata",
    generator,
  });
  recordSessionOperations(session.operations, {}, session.rootDirectory, session);
}
