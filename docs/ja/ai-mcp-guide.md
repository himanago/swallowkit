# AI / MCP 統合

SwallowKit は machine-readable CLI（`swallowkit machine`）と同梱の MCP stdio サーバー（`swallowkit-mcp`）を提供します。コーディングエージェントがファイルシステムを推測して直接編集するのではなく、正式な generator / inspector / validator を経由して操作できるようにするためです。

## アーキテクチャ

統合面は次のように分離されています。

1. **人間向け CLI**: interactive prompt、colored log、人間向けガイダンス
2. **machine CLI**: `swallowkit machine ...` による deterministic JSON 出力
3. **MCP runtime**: `swallowkit-mcp` による stdio adapter
4. **project manifest**: `.swallowkit/project.json` に保持される framework-owned metadata

これにより、framework ロジックは SwallowKit 本体に集約しつつ、AI integration の境界を明示できます。

## Machine CLI

AI が構造化された project 情報を取得したい場合や、interactive prompt なしで正式 generator を呼びたい場合に使います。

### Inspection

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
```
```bash [pnpm]
pnpm swallowkit machine inspect project
pnpm swallowkit machine inspect entities
pnpm swallowkit machine inspect routes
```
:::

返される主な情報:

- manifest の取得元
- entity / schema metadata
- BFF / Functions の route 対応
- connector / auth / architecture metadata

### Validation

::: code-group
```bash [npm]
npx swallowkit machine validate project
```
```bash [pnpm]
pnpm swallowkit machine validate project
```
:::

validation は構造化 violation として以下を返します。

- config error
- naming issue
- generated artifact 欠落
- required file / directory 欠落
- SwallowKit の layer をまたぐ forbidden dependency

### Generation

::: code-group
```bash [npm]
npx swallowkit machine generate model todo --overwrite never
npx swallowkit machine generate scaffold todo --api-only
```
```bash [pnpm]
pnpm swallowkit machine generate model todo --overwrite never
pnpm swallowkit machine generate scaffold todo --api-only
```
:::

生成も非対話で行われ、作成・更新された artifact を JSON で返します。

### Plan / Apply

書き込み前に変更内容を確認する 2 段階フローです。自律エージェントにはこちらを推奨します。

::: code-group
```bash [npm]
npx swallowkit machine plan scaffold todo --api-only
npx swallowkit machine apply scaffold --plan <planId>
npx swallowkit machine apply scaffold todo --approve
```
```bash [pnpm]
pnpm swallowkit machine plan scaffold todo --api-only
pnpm swallowkit machine apply scaffold --plan <planId>
pnpm swallowkit machine apply scaffold todo --approve
```
:::

- `plan scaffold` はファイルを一切書かず、作成 / 更新 / 上書き予定のファイル一覧と競合（conflict）を返します。plan は `.swallowkit/state/plans/` に保存され、`planId` で参照できます。
- `apply scaffold --plan <planId>` は、plan 作成後に対象ファイルが変更されていた場合 `stale-plan`（`status: "blocked"`）で拒否します。
- 生成後に手編集された managed ファイルを上書きする場合は `approval-required`（`status: "requires-human"`）となり、`--approve` の明示が必要です。
- C# / Python の外部 codegen（OpenAPI / native schema）は plan には含まれず、warning として報告されます。
- `plan auth --provider <p>` / `apply auth` も同じ 2 段階フローで動作します（`custom-jwt` / `swa` / `external-token` / `none`、`--scheme` で named scheme 追加）。

### Provision（Plan / Apply、常に承認必須）

::: code-group
```bash [npm]
npx swallowkit machine plan provision -g my-rg --location japaneast --swa-location eastasia
npx swallowkit machine apply provision --plan <planId> --approve
```
```bash [pnpm]
pnpm swallowkit machine plan provision -g my-rg --location japaneast --swa-location eastasia
pnpm swallowkit machine apply provision --plan <planId> --approve
```
:::

- `plan provision` はローカルの決定論的プリフライトのみを行います（Bicep 解析、az CLI の有無、実行予定コマンドのプレビュー）。Azure への接続や `az login` は不要です。
- `--what-if` を明示した場合のみ `az deployment group what-if` を実行します（`az login` 済みが前提）。
- provision は課金リソースを作成するため、plan は常に `requiresApproval: true`（`status: "requires-human"`）です。`apply provision` は人間の承認を反映した `--approve` がない限り実行されません。

### Responsibility Boundary / Infra Inspection

::: code-group
```bash [npm]
npx swallowkit machine inspect boundaries
npx swallowkit machine inspect infra
```
```bash [pnpm]
pnpm swallowkit machine inspect boundaries
pnpm swallowkit machine inspect infra
```
:::

- `inspect boundaries` は **AI の自由生成と SwallowKit の決定論的処理の責任分界点**を機械可読な契約として返します。各 ownership に `zone`（`deterministic` / `ai-authored` / `shared`）と `editPolicy`（`regenerate-via-plan-apply` / `free-edit` / `edit-outside-markers` / `never-hand-edit`）が対応付けられ、台帳に載っていないパスは `conventionRules`（prefix 規約）で解決されます。エージェントは編集前にこの契約を参照し、`deterministic` 領域は plan/apply 経由で変更してください。
- `inspect infra` は `infra/` 配下の Bicep 資産（params / modules / outputs / container 配線状態）を Azure を呼ばずに解析します。scaffold が生成した container が `main.bicep` に配線されていない場合は `container-not-wired` warning を返します。

### Artifact / Drift Inspection

::: code-group
```bash [npm]
npx swallowkit machine inspect artifacts
npx swallowkit machine inspect drift
```
```bash [pnpm]
pnpm swallowkit machine inspect artifacts
pnpm swallowkit machine inspect drift
```
:::

- `inspect artifacts` は生成物台帳（`.swallowkit/artifacts.json`）の内容を、ownership（`managed` / `generated-once` / `user-owned` / `extension-point` / `metadata`）と modified / missing フラグ付きで返します。
- `inspect drift` はスキーマ変更（schema-drift）、手編集（artifact-modified）、欠損（artifact-missing）、generator バージョン差（generator-drift）、manifest 乖離（manifest-drift）を検出し、各 finding に `repairAction` を付与します。

### Verify / Explain

::: code-group
```bash [npm]
npx swallowkit machine verify project
npx swallowkit machine verify project --checks structure,drift
npx swallowkit machine explain failure
npx swallowkit machine explain failure --check typecheck
```
```bash [pnpm]
pnpm swallowkit machine verify project
pnpm swallowkit machine verify project --checks structure,drift
pnpm swallowkit machine explain failure
pnpm swallowkit machine explain failure --check typecheck
```
:::

- `verify project` は `structure`（構造規約）/ `drift`（生成物乖離）/ `typecheck`（TypeScript 型検査）を実行し、各チェックの evidence（コマンド、exit code、ログ末尾）と `suggestedActions` を返します。`summary.done: true` が完了判定です。
- `--checks` には `build` / `lint` / `test`（package.json の同名 script がある場合のみ実行、なければ skip）も指定できます。
- `swallowkit.config.json` の `verify.checks` にカスタムチェック（`{ "id": "smoke-api", "command": "node scripts/smoke.js" }`）を定義すると、既定セットに追加されます。id は `^[a-z][a-z0-9-]*$` に一致し、組み込み id と重複しないものだけが有効です。
- `explain failure` は直近の verify 結果から失敗チェックの証拠と修復アクションを返します。

## レスポンス形式

machine command は stdout に必ず 1 つの JSON を出力します。

### 成功時

```json
{
  "ok": true,
  "command": "inspect-project",
  "status": "complete",
  "data": {
    "manifestSource": "file",
    "manifest": {}
  }
}
```

### 失敗時

```json
{
  "ok": false,
  "command": "generate-scaffold",
  "status": "failed",
  "error": {
    "code": "internal-error",
    "message": "..."
  }
}
```

### Terminal State

すべての machine command は `status` を返し、自律ループの終端判定に使えます。

| status | 意味 |
| --- | --- |
| `complete` | 操作完了。次のステップに進んでよい |
| `in-progress` | 未解決の問題が残っている（例: verify 失敗）。修正を続ける |
| `blocked` | 前提条件が崩れている（例: stale-plan、not-a-swallowkit-project）。前のステップをやり直す |
| `requires-human` | 人間の判断・承認が必要（例: approval-required） |
| `failed` | 操作自体が失敗 |

成功応答には、次に実行すべきコマンドを示す `nextActions` が含まれることがあります。

主なガードレール系エラーコード:

- `not-a-swallowkit-project`（blocked）— 書き込み系コマンドをプロジェクト外で実行した。プロジェクトルートに移動する
- `stale-plan`（blocked）— plan 作成後に対象ファイルが変更された。再 plan する
- `plan-not-found`（blocked）— plan が存在しないか破損している。再 plan する
- `approval-required`（requires-human）— 上書き・プロビジョニングに人間の承認が必要。エラーではなくガードレール

## Project Manifest

SwallowKit は project semantics を `.swallowkit/project.json` に保持します。

次の framework-owned mutation の後で manifest が同期されます。

- `init`
- `create-model`
- `scaffold`
- `add-connector`
- `add-auth`

inspection / validation はこの manifest を project map の一次情報として利用します。manifest が存在しない場合は、現在の project structure から再構築します。

## MCP Server

MCP 対応の agent platform では、同梱の stdio server を使います。

::: code-group
```bash [npm]
npx swallowkit-mcp
```
```bash [pnpm]
pnpm swallowkit-mcp
```
:::

公開される Tool は明示的なものだけです。

- `swallowkit_inspect_project`
- `swallowkit_inspect_entities`
- `swallowkit_inspect_routes`
- `swallowkit_inspect_artifacts`
- `swallowkit_inspect_boundaries`
- `swallowkit_inspect_drift`
- `swallowkit_inspect_infra`
- `swallowkit_validate_project`
- `swallowkit_generate_model`
- `swallowkit_scaffold_model`
- `swallowkit_plan_scaffold`
- `swallowkit_apply_scaffold`
- `swallowkit_plan_auth`
- `swallowkit_apply_auth`
- `swallowkit_plan_provision`
- `swallowkit_apply_provision`
- `swallowkit_verify_project`
- `swallowkit_explain_failure`

MCP 層は framework ロジックを持たず、各 Tool 呼び出しを machine CLI に委譲します。

## 生成プロジェクトでの bootstrap

`swallowkit init` は、repository root に project-scoped な `.mcp.json` を出力します。起動ごとに最新の SwallowKit MCP entrypoint を解決し、固定する場合はファイル内の `SWALLOWKIT_MCP_VERSION` を変更します。

例:

```json
{
  "mcpServers": {
    "swallowkit": {
      "command": "node",
      "args": ["./node_modules/swallowkit/dist/mcp/index.js"],
      "cwd": "."
    }
  }
}
```

実際の挙動:

- **Claude Code** は `.mcp.json` の project-scoped MCP server を読み込めます
- **GitHub Copilot CLI** も workspace の `.mcp.json` server を検出できます
- **その他の agent / Codex 系 runtime** も、project-level config をサポートしていれば同じ launcher を再利用でき、未対応なら machine CLI fallback を使います

生成される instruction files（`AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`）は、MCP Tool が使えるときはそれを優先し、使えないときは `swallowkit machine ...` にフォールバックするよう案内します。MCP bootstrap には pnpm が必要で、選択したバージョンが cache にない場合は network access も必要です。

### Agent Skills（agentskills.io 標準）

`init` は自律ループのランブックを [Agent Skills](https://agentskills.io/) 標準のスキルとしても `.github/skills/` に生成します。Skills 対応エージェント（GitHub Copilot の VS Code / CLI / cloud agent など）は frontmatter の `name` / `description` だけを常駐ロードし、タスクが合致したときだけ本文を読み込みます（progressive disclosure）。

| スキル | 用途 |
|--------|------|
| `swallowkit-add-model` | モデル / CRUD 機能の追加（plan/apply/verify ループ） |
| `swallowkit-modify-model` | 既存スキーマ変更と drift 解消 |
| `swallowkit-verify-repair` | 検証と修復の収束ループ |
| `swallowkit-provision` | Azure プロビジョニング（必ず人間の承認を経由） |

Skills 非対応のエージェント向けには、同一内容のランブックが `.swallowkit/workflows/` にあり、`AGENTS.md` から参照されます。

## 推奨フロー

- まず **inspect** で SwallowKit が理解している project structure を取得する
- 書き込みを伴う操作は **plan → (確認) → apply** の 2 段階で行う
- 適用後は **verify** で検証し、失敗したら **explain failure** で証拠を取得して修正する
- 生成の前後で **validate** / **inspect drift** を実行して framework rule violation と乖離を確認する
- framework-owned artifact（ownership: `managed`）は手書き編集より **generate / apply** を優先する
- アプリ固有ロジックは手書きしてよいが、生成構造と metadata は SwallowKit に管理させる

典型的な自律ループ:

```text
inspect project → plan scaffold → apply scaffold --plan <id> → verify project
   └ 失敗時: explain failure → 修正 → verify project (繰り返し)
   └ approval-required 時: 人間に確認 → apply scaffold --approve
```

責任分界の原則:

| zone | 編集ポリシー | 例 |
| --- | --- | --- |
| `deterministic` | 手編集せず plan/apply で再生成 | `functions/src/*.ts`, `app/api/*/route.ts`, `infra/containers/` |
| `ai-authored` | AI / 開発者が自由に記述 | `app/**/page.tsx`（生成後）, `lib/`, 独自コード |
| `shared` | マーカー外のみ編集可 | `infra/main.bicep`, `functions/function_app.py`, `shared/index.ts` |

編集前に `inspect boundaries`（または `swallowkit_inspect_boundaries`）で契約を取得し、`deterministic` 領域への変更はモデル編集 + plan/apply に置き換えてください。
# machine/MCP出力の認証情報

`inspect project` と対応するMCP project inspectionは、正規化済みの `auth.schemes` と `auth.authorization.policies` を返します。旧単一provider設定は `default` スキーム、`public` は `anonymous` として現れます。validation診断には設定パスと修正方法が含まれます。利用側は不正または欠落したポリシーを匿名として解釈してはいけません。
