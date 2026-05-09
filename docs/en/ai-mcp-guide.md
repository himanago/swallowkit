# AI / MCP Guide

SwallowKit provides a **machine-readable CLI** and a bundled **MCP stdio server** so coding agents can operate through the framework's official generators, inspectors, and validators instead of guessing raw filesystem edits.

## Architecture

The integration surface is intentionally layered:

1. **Human CLI**: interactive prompts, colored logs, human-readable guidance
2. **Machine CLI**: `swallowkit machine ...` with deterministic JSON output
3. **MCP runtime**: `swallowkit-mcp`, a thin stdio adapter over the machine CLI
4. **Project manifest**: `.swallowkit/project.json`, the framework-owned project metadata used for inspection and validation

This keeps framework logic in SwallowKit itself while making AI integrations explicit and predictable.

## Machine CLI

Use the machine interface when an agent needs structured project data or needs to invoke the official generators without interactive prompts.

### Inspection

```bash
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
```

These commands return framework-owned metadata such as:

- project manifest source
- entities and schema metadata
- generated BFF / Functions route mappings
- connectors, auth, and architecture metadata

### Validation

```bash
npx swallowkit machine validate project
```

Validation returns structured violations for:

- config errors
- naming issues
- missing generated artifacts
- missing required files/directories
- forbidden dependencies across SwallowKit layers

### Generation

```bash
npx swallowkit machine generate model todo --overwrite never
npx swallowkit machine generate scaffold todo --api-only
```

Generation stays non-interactive and returns JSON describing created or updated artifacts.

## Response Shape

All machine commands write a single JSON document to stdout.

### Success

```json
{
  "ok": true,
  "command": "inspect-project",
  "data": {
    "manifestSource": "file",
    "manifest": {}
  }
}
```

### Failure

```json
{
  "ok": false,
  "command": "generate-scaffold",
  "error": {
    "code": "internal-error",
    "message": "..."
  }
}
```

## Project Manifest

SwallowKit keeps project semantics in `.swallowkit/project.json`.

The manifest is synchronized after framework-owned mutations such as:

- `init`
- `create-model`
- `scaffold`
- `add-connector`
- `add-auth`

Inspection and validation use this manifest as the primary project map. If it is missing, SwallowKit reconstructs metadata from the current project structure.

## MCP Server

Use the bundled stdio MCP server when your agent platform supports MCP tools:

```bash
npx swallowkit-mcp
```

The server exposes explicit tools only:

- `swallowkit_inspect_project`
- `swallowkit_inspect_entities`
- `swallowkit_inspect_routes`
- `swallowkit_validate_project`
- `swallowkit_generate_model`
- `swallowkit_scaffold_model`

The MCP layer does not implement framework logic on its own. It delegates each tool call to the machine CLI.

## Recommended Usage

- Use **inspect** first to understand the SwallowKit project structure
- Use **validate** to detect framework rule violations before or after generation
- Use **generate** instead of editing framework-owned artifacts by hand
- Keep custom logic in application files, but let SwallowKit own generated structure and metadata
