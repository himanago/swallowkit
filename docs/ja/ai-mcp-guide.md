# AI / MCP ガイド

SwallowKit は、コーディングエージェントが raw filesystem を推測して直接編集するのではなく、framework の正式な generator / inspector / validator を経由して操作できるように、**machine-readable CLI** と **MCP stdio server** を提供します。

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

```bash
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
```

返される主な情報:

- manifest の取得元
- entity / schema metadata
- BFF / Functions の route 対応
- connector / auth / architecture metadata

### Validation

```bash
npx swallowkit machine validate project
```

validation は構造化 violation として以下を返します。

- config error
- naming issue
- generated artifact 欠落
- required file / directory 欠落
- SwallowKit の layer をまたぐ forbidden dependency

### Generation

```bash
npx swallowkit machine generate model todo --overwrite never
npx swallowkit machine generate scaffold todo --api-only
```

生成も非対話で行われ、作成・更新された artifact を JSON で返します。

## レスポンス形式

machine command は stdout に必ず 1 つの JSON を出力します。

### 成功時

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

### 失敗時

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

```bash
npx swallowkit-mcp
```

公開される Tool は明示的なものだけです。

- `swallowkit_inspect_project`
- `swallowkit_inspect_entities`
- `swallowkit_inspect_routes`
- `swallowkit_validate_project`
- `swallowkit_generate_model`
- `swallowkit_scaffold_model`

MCP 層は framework ロジックを持たず、各 Tool 呼び出しを machine CLI に委譲します。

## 推奨フロー

- まず **inspect** で SwallowKit が理解している project structure を取得する
- 生成の前後で **validate** を実行して framework rule violation を確認する
- framework-owned artifact は手書き編集より **generate** を優先する
- アプリ固有ロジックは手書きしてよいが、生成構造と metadata は SwallowKit に管理させる
