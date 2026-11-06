import * as path from "path";
import { AuthConfig } from "../../types";
import { authSchemeSlug, normalizeAuthConfig } from "../config";
import { generateAuthenticatedFetch } from "../scaffold/auth-generator";
import { generateReactBffHelper } from "../scaffold/react-bff-generator";
import { FileOperationSession, FileWriteMeta } from "./file-session";

/** Keep both sides of the managed SWA hop in the same plan. */
export function writeReactAuthTransport(
  session: FileOperationSession,
  projectRoot: string,
  apiDir: string,
  projectName: string,
  auth: AuthConfig | undefined,
  meta: FileWriteMeta
): void {
  session.writeFile(path.join(projectRoot, apiDir, "src", "lib", "call-function.ts"), generateReactBffHelper(projectName, auth), meta);
  for (const [scheme, config] of Object.entries(normalizeAuthConfig(auth)?.schemes ?? {})) {
    if (config.provider !== "external-token") continue;
    const named = Object.prototype.hasOwnProperty.call(auth?.schemes ?? {}, scheme);
    const slug = authSchemeSlug(scheme);
    const authDir = path.join(projectRoot, "lib", "auth", ...(named ? ["schemes", slug] : []));
    session.writeFile(path.join(authDir, "authenticated-fetch.ts"), generateAuthenticatedFetch(true, named), meta);
  }
}
