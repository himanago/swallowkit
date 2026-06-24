# Zod schema sharing

This content has been reorganized. See:

- [Core concepts](/en/concepts) — Schema-as-source-of-truth design, layer responsibilities, BFF pattern
- [Getting started](/en/getting-started) — Creating and using schemas in practice
- [Scaffold guide](/en/scaffold-guide) — Generating code from schemas, nested schemas, multi-model workflows

## Summary

SwallowKit uses a single Zod schema definition in `shared/models/` as the source of truth for the entire application. From this schema, it derives:

- TypeScript types via `z.infer<>`
- Frontend form validation
- BFF request/response validation
- Backend handler validation
- Cosmos DB document structure
- OpenAPI contracts (C#/Python backends)
- Generated UI components

The schema is never duplicated across layers. When it changes, `swallowkit scaffold` regenerates the affected code.

For TypeScript backends, the Zod schema is imported directly in Azure Functions. For C#/Python backends, `scaffold` exports an OpenAPI document and generates native models under `functions/generated/`.
