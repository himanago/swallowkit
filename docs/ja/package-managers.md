# パッケージマネージャー

Node.js 22.14 以上（22／24 をテスト）、pnpm 11／12 または npm 10 以上を使います。SwallowKit 自体の開発リポジトリは npm 管理のままです。

| 操作 | pnpm | npm |
| --- | --- | --- |
| 新規作成 | `pnpm dlx swallowkit init my-app` | `npx swallowkit init my-app` |
| model | `pnpm exec swallowkit create-model todo` | `npx swallowkit create-model todo` |
| scaffold | `pnpm exec swallowkit scaffold todo` | `npx swallowkit scaffold todo` |
| 開発 | `pnpm exec swallowkit dev` | `npx swallowkit dev` |
| 検証 | `pnpm exec swallowkit machine verify project` | `npx swallowkit machine verify project` |
| build | `pnpm run build` | `npm run build` |
| lockfile に従う導入 | `pnpm install --frozen-lockfile` | `npm ci` |

通常操作は `cd my-app` 後に実行します。生成プロジェクトは生成に使った SwallowKit のバージョンを固定します。`npx` もそのローカル版を使います。未導入時のダウンロードを禁止するには `npx --no-install swallowkit …` を使えます。グローバルインストールは不要です。

`init --package-manager npm|pnpm` が最優先です。未指定なら起動元の user agent を使うため、pnpm がインストール済みでも `npx` から起動すれば npm を選びます。user agent のない直接起動では利用可能な pnpm、次に npm を選びます。既存プロジェクトの操作は metadata と lockfile を参照します。

root の install で `shared/`、TypeScript backend なら `functions/` も導入します。選択した lockfile だけをコミットしてください。pnpm は `pnpm-workspace.yaml`、npm は npm workspaces と `package-lock.json` を使います。生成 CI も選択した manager で root の frozen install を実行します。`devEngines.packageManager` は対応範囲を指定し、pnpm は選択した版を lockfile に保存します。patch 固定を生成しません。[pnpm 11 の仕様](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md)も参照してください。

MCP は最新情報を使うため、選択した manager で意図的に `swallowkit@latest` を解決します。`.mcp.json` は pnpm の package/dlx または npm の `npx --yes --package` を使います。通常のローカル CLI とは独立して更新されるため、beta のバージョン差が生じる可能性があります。未キャッシュの版にはネットワークが必要です。オフライン・再現性が必要な場合は `.mcp.json` 内の `SWALLOWKIT_MCP_VERSION` を指定して事前にキャッシュするか、ローカル machine CLI を使います。npm project の MCP に pnpm は不要です。

Azure Functions Core Tools v4 と各 backend runtime は別途必要な開発環境です。そのバイナリ installer は CLI の依存に含めません。frontend 単独なら `dev --no-functions --no-swa` を利用できます。

## build script と security policy の切り分け

CLI の `tsx → esbuild` 依存は削除し、packed artifact の runtime dependency tree に install script がないことを検査します。旧版の bootstrap で `ERR_PNPM_IGNORED_BUILDS` が `esbuild` を示す場合は、この修正を含む SwallowKit に更新してください。

生成アプリの project-local `allowBuilds` は、不要な `protobufjs`（Application Insights 経由のバージョン指定に関する通知）と `unrs-resolver`（native binding の fallback installer。対応 platform では optional な配布済み binary を利用）の script を明示的に **拒否** します。実行許可は与えません。未知の依存は引き続きレビュー対象です。wildcard、global 許可、release age・trust policy の例外は生成しません。

別の package が表示されたら `pnpm why <package>` とその `package.json`／script を確認し、アプリや platform に本当に必要か判断してください。必要な場合だけ内容をレビューし project-local に許可します。script は利用者の権限でコードを実行します。init を通すための一括承認や security controls の無効化は不要です。

pnpm の `dlx`／`create` にも、親 project を含む release-age・trust policy が適用されます。新しい beta や依存が待機期間中である場合は意図的な拒否です。適格になるまで待つか、既に適格な版を使ってください。SwallowKit は迂回しません。[pnpm の bootstrap security 仕様](https://pnpm.io/cli/pnx#security-and-trust-policies)を参照してください。
