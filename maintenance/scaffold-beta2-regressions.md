# Scaffold nested imports and reference routes

The fixes target the `2.0.0-beta.2` generators for React/Vite and Next.js, with
TypeScript, C#, and Python backends. Plan/apply still runs the existing scaffold
generation path, artifact ledger, conflict checks, and input fingerprints.

## Cause and behavior

The previous imported-schema detector searched the complete object body with
regular expressions. For an inline `publication`, it added its imported
`provider` and `validation` children to the root. The static parser also described
imported objects without their fields. These are separate losses of hierarchy.

The detector now inspects only immediate AST properties. Imported schema fields
are recursively analyzed in their own module and retain their child fields and
constraints. Aliases select the original named export, including multiple exports
in one contracts file. The native model graph selects that export explicitly,
rather than inferring its name from the filename. Inline definitions and local
constants produce identical metadata and OpenAPI.

The supplied inline example reproduced an additional NSwag failure: an import
named `ProviderInfo` from `common.ts` produced a root `$ref` to `ProviderInfo`,
while the graph generated a component named `Common`. NSwag 14.7.1 failed with:

```text
System.InvalidOperationException: Could not resolve the path '#/components/schemas/ProviderInfo'.
```

The corrected OpenAPI passed the same NSwag command. This establishes a causal
path for the reported failure; it does not imply that every NSwag error has this cause.

Reference option fetches, BFF registration, OpenAPI paths, and the three backend
generators now share `getModelApiRoute`. `GrammarTopic` keeps `/api/grammarTopic`;
its page remains `/grammar-topic`. No authorization bypass or alias route is added.

Additional issues exposed by the fixtures were fixed in the generators:

- OpenAPI carries nullable scalars, objects, and arrays, including nullable references.
- Python distinguishes omitted optional values from nullable values, retains explicit
  nulls during serialization, and rejects an absent required nullable child.
- C# constructor parameters escape reserved words such as `checked`.
- Forms and Next.js BFF omit/partial only managed fields present in the schema,
  allowing the reported model without `createdAt` and `updatedAt` to compile.

## Regression coverage

`scaffold-nested-imports.test.ts` covers Zod v3/v4, static and runtime analysis,
import aliases, multiple exports, local/inline equivalence, nullable/optional
children, object arrays, and imported contract input fingerprints.

The added cases in `generated-project-matrix.test.ts` scaffold both `GrammarTopic`
and `SampleQuestion` for both frontends and all three backends. They check
plan/apply, idempotent re-planning, resolved OpenAPI references, generated UI/BFF
typechecking, backend compilation/import resolution, and stale imported inputs.
`generated-reference-flow.ts` executes the generated React form, managed BFF,
TypeScript CRUD handlers, and SWA role guards. It tests option retrieval,
selection, nested JSON submission, saving, 403 for non-admins, and 401 for anonymous
users. Cosmos input/output bindings use an isolated in-memory store.

Run the new matrix cases with:

```powershell
node node_modules/jest/bin/jest.js --runInBand --testMatch '**/*.test.ts' --testPathPattern generated-project-matrix --testNamePattern 'scaffold nested imports and references'
```

Set `SWALLOWKIT_TEST_REAL_CODEGEN=1` to exercise actual NSwag during C# apply.
Set `SWALLOWKIT_TEST_PYTHON` to a Python executable with Pydantic installed to
exercise generated Python serialization and null/missing validation. Both modes
were exercised for this fix, along with C# Functions builds and a real
datamodel-code-generator invocation. Live Cosmos DB and Azure deployment were
not tested.

The wider test run exposed an existing Windows failure in
`boundaries.test.ts` (`resolves the backend language from swallowkit.config`:
expected `csharp`, received `typescript`). It also fails in the unmodified checkout.

## Regenerating existing projects

Plan/apply the referenced model, then the referencing model. Review managed
forms, OpenAPI and native model updates and new embedded-class files. Existing
CRUD URLs stay unchanged. User edits and generated-once files keep their normal
ownership protection; old unused native files are not automatically deleted.

The local-constant workaround may be removed: equivalent inline definitions are
supported. Remove the `/api/grammar-topic` rewrite after deploying the regenerated
form if no other client still uses that alias. No generated files need manual fixes.

## Additional compatibility review

The follow-up review found and fixed a regression in the first AST change:
`z.array(ImportedSchema).min(1)` stopped being recognized as an entity selector.
The detector now follows shape-preserving validation wrappers and fluent `.array()`
without searching child object properties. Parameterized tests cover six forms
of direct entity reference with both Zod v3 and v4. Six additional matrix cases
scaffold the referenced and referencing models, check constrained array selectors
and native `$ref` identity, compile both frontends and all three backends, and
verify that re-planning is a no-op.

Python compatibility tests execute the existing `from_dict`, `from_json`,
`to_dict`, and `to_json` methods with scalar values, camelCase/snake_case aliases,
optional values, explicit nullable values, and assignment after construction.
They also check strict scalar/enum validation and the difference between a missing
required nullable field and an omitted optional field.

The existing C# round-trip fixture now includes optional reserved-word properties
(`checked`, `event`) alongside its scalar, enum, array, nested-object, and nullable
cases. Compilation succeeds, but this follow-up's runtime execution is blocked by
Windows application control while loading `RoundTrip.dll` (`0x800711C7`), including
outside the sandbox. This runtime check remains unverified; no system policy was
changed. The six new generated-project compatibility cases, including C# Functions
builds, passed.

The follow-up full matrix run passed 765 tests and skipped 33 slower .NET cases
(`SWALLOWKIT_TEST_SKIP_DOTNET=1`); the six new compatibility cases were also run
separately with actual C# builds enabled. The focused related suites passed 163
tests, and the expanded Zod v3/v4 import suite passed 14 tests. Toolkit build and
lint completed with no errors.

One intentional Python behavior correction should be distinguished from legacy
compatibility: an explicitly supplied `None` for a field that is optional but
not nullable is rejected. Omission remains supported. Nullable fields retain
explicit nulls. This follows the source Zod schema; the generated BFF already
enforces that distinction.
