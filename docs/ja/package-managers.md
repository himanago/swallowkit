# パッケージマネージャー

Node.js 22.14 以上、pnpm 11／12 または npm 10 以上を使います。SWA にデプロイするアプリの CI では Node.js 22 系を使います。

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

root の install で `shared/`、TypeScript backend なら `functions/` も導入します。選択した lockfile だけをコミットしてください。pnpm は `pnpm-workspace.yaml`、npm は npm workspaces と `package-lock.json` を使います。Functions の CI は選択した manager で root の frozen install を実行します。SWA は内部の npm/Oryx に合わせ、CI の checkout だけ npm 用に変換する例外です（後述）。`devEngines.packageManager` は対応範囲を指定し、pnpm は選択した版を lockfile に保存します。patch 固定を生成しません。[pnpm 11 の仕様](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md)も参照してください。

MCP は最新情報を使うため、選択した manager で意図的に `swallowkit@latest` を解決します。`.mcp.json` は pnpm の package/dlx または npm の `npx --yes --package` を使います。通常のローカル CLI とは独立して更新されるため、beta のバージョン差が生じる可能性があります。未キャッシュの版にはネットワークが必要です。オフライン・再現性が必要な場合は `.mcp.json` 内の `SWALLOWKIT_MCP_VERSION` を指定して事前にキャッシュするか、ローカル machine CLI を使います。npm project の MCP に pnpm は不要です。

Azure Functions Core Tools v4 と各 backend runtime は別途必要な開発環境です。そのバイナリ installer は CLI の依存に含めません。frontend 単独なら `dev --no-functions --no-swa` を利用できます。

## build script と security policy の切り分け

SwallowKit CLI の起動に `esbuild` の build script 承認は不要です。旧版の `init` で `ERR_PNPM_IGNORED_BUILDS` が `esbuild` を示す場合は、SwallowKit を更新してから再実行してください。

生成アプリの project-local `allowBuilds` は、不要な `protobufjs`（Application Insights 経由のバージョン指定に関する通知）と `unrs-resolver`（native binding の fallback installer。対応 platform では optional な配布済み binary を利用）の script を明示的に **拒否** します。実行許可は与えません。未知の依存は引き続きレビュー対象です。wildcard、global 許可、release age・trust policy の例外は生成しません。

別の package が表示されたら `pnpm why <package>` とその `package.json`／script を確認し、アプリや platform に本当に必要か判断してください。必要な場合だけ内容をレビューし project-local に許可します。script は利用者の権限でコードを実行します。init を通すための一括承認や security controls の無効化は不要です。

pnpm の `dlx`／`create` にも、親 project を含む release-age・trust policy が適用されます。新しい beta や依存が待機期間中である場合は意図的な拒否です。適格になるまで待つか、既に適格な版を使ってください。SwallowKit は迂回しません。[pnpm の bootstrap security 仕様](https://pnpm.io/cli/pnx#security-and-trust-policies)を参照してください。


## pnpm プロジェクトの SWA デプロイ

ローカル開発では pnpm を使います。SWA の生成ワークフローは、Azure のビルド環境に合わせて CI 内のファイルだけを npm 用に変換します。ローカルの `package.json` や `pnpm-lock.yaml` を変更する必要はありません。Functions の CI は選択したパッケージマネージャーを使います。

SWA の Node.js は、CI 内の `package.json` の `engines.node` で `>=22.14.0 <23` に制限します。`actions/setup-node` の指定は GitHub runner 用で、SWA 内の Node.js 選択とは別です。[Azure のビルド設定](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration#custom-build-commands)を参照してください。

GitHub runner では `npm ci && npm run build` を実行します。SWA action の `app_build_command` は `npm run build` のみです。Azure のビルドエンジン Oryx が先に依存をインストールするため、ここに `npm ci` を追加しないでください。[Oryx のビルド順序](https://github.com/microsoft/Oryx/blob/main/doc/runtimes/nodejs.md#build)を参照してください。

### 既存ワークフローでエラーが出る場合

CLI を更新しても、既存アプリのワークフローは自動更新されません。アプリ固有の設定を維持し、次を確認してください。

| エラー | 確認する設定 |
| --- | --- |
| `EBADDEVENGINES`：npm と pnpm の不一致 | CI 内の npm 用変換を、最初の npm 操作より前に実行します。変換前の `setup-node` に `cache: npm` を指定すると、キャッシュ参照でも npm が起動するため、この指定を外します。 |
| Oryx 内の `npm ci` で lockfile 不整合 | SWA の `app_build_command` を `npm run build` にします。runner 側の `npm ci` は維持します。 |
| `Node version 24 … is not supported` | SWA に渡す `package.json` の `engines.node` を `>=22.14.0 <23` にします。 |

パッケージマネージャーの検査だけを無効化しても、workspace の依存参照や build コマンドの不一致は解消しません。npm 用変換のステップ全体を確認してください。
