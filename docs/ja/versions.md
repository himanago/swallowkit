# 対象バージョン

このサイトは SwallowKit **2.x** の仕様を説明しています。現在のソースは `2.0.0-beta.3` です。
2.x はプレリリースで、npm の `latest` が指す安定版 **1.x** とは仕様が異なります。
1.x で作成したプロジェクトに、このサイトの手順をそのまま適用しないでください。

## 系列の選び方

| 系列 | npm のタグ | このサイトとの関係 |
| --- | --- | --- |
| 1.x 安定版 | `latest` | このサイトの対象外です。使用中のバージョンのドキュメントを確認してください。 |
| 2.x プレリリース | `beta` | このサイトの対象です。React + Vite と SWA マネージド Functions BFF は 2.x から利用できます。 |

Next.js は引き続き既定の構成です。既存設定で `frontend.framework` が省略されていても、React に切り替わることはありません。
React を選ぶ場合は、2.x で初期化し、`--frontend react` を指定してください。

## 2.x でプロジェクトを作る

```sh
npx swallowkit@beta init my-app --frontend react --package-manager npm
cd my-app
npx swallowkit --version
```

pnpm を使う場合は、初期化を `pnpm dlx swallowkit@beta init my-app --frontend react --package-manager pnpm` で実行します。
作成したプロジェクト内では `pnpm exec swallowkit ...` を使ってください。
`@beta` を省略した初回の `npx swallowkit@beta init` や `pnpm dlx swallowkit@beta init` は、npm の安定版を取得します。

同じバージョンで再現する場合は、`@beta` の代わりに `@2.0.0-beta.3` を指定します。
既存の 1.x プロジェクトへの `init` の再実行は移行手順ではありません。依存関係、設定、生成物の差分を確認し、別の作業ブランチで移行を検証してください。

## 使用中のバージョンを確認する

プロジェクトのルートで `npx swallowkit --version` または `pnpm exec swallowkit --version` を実行してください。
公開済みの系列は `npm view swallowkit dist-tags` で確認できます。
MCP サーバーのバージョンは CLI と異なる場合があるため、[MCP のバージョン選択](./ai-mcp-guide.md#mcp-のバージョン選択)も確認してください。

1.x を使用する場合は、[1.x のドキュメントソース](https://github.com/himanago/swallowkit/tree/maintenance/1.x/docs)を参照してください。
このサイトには、1.x の画面やコマンドとの互換性を保証する説明はありません。
