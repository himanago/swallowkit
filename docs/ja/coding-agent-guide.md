# コーディングエージェントガイド

生成先の指示は `frontend.framework` に応じて Next.js API Routes、または
React SPA + SWA マネージド Functions BFF を説明します。`app/api` の存在を仮定せず、
`.swallowkit/project.json` を検査してください。パス、検証、環境上の注意は [React ガイド](./react-guide.md)を参照してください。
このツールキット自身の直下の `AGENTS.md` は生成先のテンプレートとは別の開発者向け指示です。

pnpm 11/12 と npm の使い分けは[コマンドとトラブルシューティング](./package-managers.md)を参照してください。

SwallowKit は要件整理や実装、レビューの進め方を決めるツールではありません。
エージェントが現在のプロジェクトを調べ、モデルや設定から生成物を再現し、変更後の構造を検証するために使います。
コマンドと応答形式の詳細は [AI / MCP 統合](./ai-mcp-guide.md)を参照してください。

## 目的

開発プロセスを定めるスキルやフレームワークには、要件整理、仕様作成、チケット分割、TDD、実装、レビューの進め方を任せます。
その中で SwallowKit を呼び出すと、現在のモデル・ルート・所有権を調べ、変更計画を作り、適用後に検証できます。
エージェントは、取得した情報を根拠に編集するファイルと再生成するファイルを区別します。

```text
要件・仕様・作業内容を決める
  ↓
現在のプロジェクトと編集規則を調べる（inspect）
  ↓
生成物の変更計画を確認して適用する（plan/apply）
  ↓
構造を検証し、実際の動作を確かめる（verify・テスト）
```

SwallowKit はプロジェクトの検査、生成物の再生成、記録からのずれの検出、構造の検証、失敗した検査の説明を担当します。
独自の要件定義やチケット管理の仕組みを導入するものではありません。

## 生成される指示ファイル

`swallowkit init` は、共通の規約と、利用するエージェントや作業ごとの指示を分けて生成します。

| ファイル | 役割 |
| --- | --- |
| `AGENTS.md` | すべての作業で参照する共通のプロジェクト規約 |
| `CLAUDE.md` | Claude Code に共通規約の参照を指示するファイル |
| `.github/copilot-instructions.md` | GitHub Copilot に共通規約の参照を指示するファイル |
| `.github/instructions/*.instructions.md` | ファイルの場所やレイヤーごとの編集規則 |
| `.mcp.json` | プロジェクトで使用する SwallowKit MCP サーバーの起動設定 |
| `.github/skills/*/SKILL.md` | 特定の作業で読み込む Agent Skills |
| `.swallowkit/workflows/*.md` | Agent Skills 非対応のエージェントも読める作業手順書 |

Claude Code と Copilot 向けの指示にも、最初に `AGENTS.md` を読むことや MCP の利用方針を記載します。
モデル追加や検証などの詳しい手順は、対応するスキルまたは作業手順書に置きます。

これらのファイルは Next.js / React、各バックエンド言語、npm / pnpm 向けに `init` が生成します。
`init` は既存ディレクトリを拒否し、SwallowKit の更新だけでは指示ファイルは更新されません。
指示ファイル専用の更新コマンドはありません。既存プロジェクトに新しい指示を取り込む場合は、
選択済みのフロントエンド / バックエンド / パッケージマネージャーに合わせて新旧テンプレートの差分を確認し、
共通の `AGENTS.md` と必要な参照指示ファイル / 作業手順書に手動でマージしてください。
プロジェクト独自の指示を保ち、既存ドキュメントの上書きや既存プロジェクトへの `init` は避けます。

共通のプロジェクト規約は、Cosmos（本番）/ Emulator（ローカル）の永続化と障害を隠す代替ストレージの禁止、
`dev-seeds/<environment>/` の明示的な適用、ローカル操作時のデータ保護を定めます。
シードファイル名は複数形のコンテナー名ではなく、モデル名の単数形 kebab-case
（例: `learning-profile.json`）です。置換成功と判断する前に、実効 DB 名とシードログを確認します。
ビルド、テスト用データ、`verify project` は機械的な証拠にとどまります。起動・永続化・API・UI の変更では、
実アプリの BFF / Functions / DB を通した動作確認も必要です。永続化は再シードせずに
再読み込み・再起動して確認します。前提条件の不足、省略、警告、模擬サービスと実サービスの違いを
明示してください。ドキュメントだけの変更には実 DB の検証は不要です。

## 開発ライフサイクル全体での SwallowKit

### 要件整理

実装の詳細を人に質問する前に、関連するモデル、ルート、インフラ、所有権を調べます。
リポジトリや検査結果から分かることはエージェントが確認し、アプリの仕様や業務上の判断が必要な点を人に質問します。

### 仕様作成

利用者が何をしたときに何が起きるか、受け入れ条件は何か、どの動作をテストするかを記述します。
SwallowKit の構成と所有権は実装上の条件として扱い、自動生成するレイヤーを別々の手作業として計画しません。

### 計画

利用できる機能や所有権が設計に影響する場合は、現在の CLI または MCP で調べます。
エージェントが学習した古い知識だけで、SwallowKit にできることを決めないでください。

### チケット分割

独立して利用者の目的を満たし、実装・検証できる単位で分割します。
1つのモデル変更からスキーマ、Functions、BFF、UI、インフラを再生成する場合は、それらを同じチケットに含めます。
生成先のディレクトリが違うという理由だけで、レイヤー別のチケットに分けません。

### 実装

ファイルを選ぶ前に編集規則を確認します。`ai-authored` は直接編集し、`deterministic` はモデルや設定と plan/apply から変更します。
`shared` はパスごとの規則に従ってください。マーカーの外だけを編集するファイルと、手動でエクスポートを追記できるファイルがあります。

### 検証

変更後に SwallowKit の検証を実行し、失敗した検査の結果を読んで修正します。
修正後は再検証し、人の判断が必要な場合は、その対象と選択肢を示します。

### レビュー

構造や生成物のずれを検証したあとに、設計と動作が仕様を満たしているかをレビューします。
機械的な検査と、利用者の目的に照らしたレビューは、互いの代わりにはなりません。

## 質問・設計の前の検査

タスクに関係する検査だけを利用します。

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
npx swallowkit machine inspect boundaries
npx swallowkit machine inspect drift
npx swallowkit machine inspect infra
```
```bash [pnpm]
pnpm exec swallowkit machine inspect project
pnpm exec swallowkit machine inspect entities
pnpm exec swallowkit machine inspect routes
pnpm exec swallowkit machine inspect boundaries
pnpm exec swallowkit machine inspect drift
pnpm exec swallowkit machine inspect infra
```
:::

利用できる場合は `swallowkit_*` MCP ツールを優先し、MCP が使えない場合は machine CLI を使用します。

これにより、生成された CRUD レイヤーの接続設定、管理対象のルートの編集可否、インフラ操作 の
有無など、現在の検査結果で回答できる質問を人間へ転嫁しません。一方、曖昧な
製品の動作、業務ルール、リスクについての判断は適切に人間へ確認します。

## 責任範囲と編集規則

`machine inspect boundaries`（または `swallowkit_inspect_boundaries`）が現在のプロジェクトの
機械可読な編集規則の確認元です。

| zone | 編集ポリシー | 典型例 |
| --- | --- | --- |
| `ai-authored` | 直接編集する | 定義元のモデル、独自のロジックや画面、テスト |
| `deterministic` | 決して手編集せずモデルや設定と plan/apply で変更する | 生成 CRUD、BFF、UI、スキーマ、インフラの生成物 |
| `shared` | 管理対象を示すマーカーの外側だけ編集する | SwallowKit の管理区間 を含む集約・インフラファイル |

例は検査の代わりにはなりません。所有権はバックエンド、機能、SwallowKit のバージョン
によって変わり得ます。

## 計画とチケット作成

仕様には、生成ファイルの作り方よりも、実現したい動作を書きます。
計画には SwallowKit の編集規則と plan/apply/verify の手順を含め、再生成で済む作業を独立した手作業として数えません。
チケットは単独で実装・検証できる機能単位にします。レイヤー別に分割するのは、それぞれに独立した価値やリスクがある場合です。

## 実装の進め方

エージェントの標準作業手順は次のとおりです。

```text
inspect → plan → conflict/approval の評価 → apply → verify
```

実行環境で MCP ツールを利用できる場合は優先し、それ以外では machine CLI を使います。

::: code-group
```bash [npm]
npx swallowkit machine inspect drift
npx swallowkit machine plan scaffold todo
npx swallowkit machine apply scaffold --plan <planId>
npx swallowkit machine verify project
```
```bash [pnpm]
pnpm exec swallowkit machine inspect drift
pnpm exec swallowkit machine plan scaffold todo
pnpm exec swallowkit machine apply scaffold --plan <planId>
pnpm exec swallowkit machine verify project
```
:::

Agent Skills 対応実行環境では `swallowkit-add-model`、`swallowkit-modify-model`、
`swallowkit-verify-repair` を利用します。それ以外では対応する
`.swallowkit/workflows/` 作業手順書を読みます。これらは上位の実装手順から
呼び出せる作業単位の機能です。

### カスタム API の有無にかかわらず、永続化モデルのインフラを生成する

新しい永続化モデルでは、
`machine plan model <model> --overwrite never` で変更予定を確認し、返された plan を
`machine apply model --plan <planId>` で適用します。スキーマを作成し、
コネクタ以外のモデル用 Cosmos コンテナーマイグレーションを登録します。
対話 CLI の `create-model` も同じ生成処理 を使います。
スキーマを編集し、共有パッケージのエクスポートを確認してください。モデル生成は Azure へのデプロイや
CRUD 生成を行いません。手書きモデルでは `machine plan model-infrastructure <model>` で
変更予定を確認し、返された plan を `machine apply model --plan <planId>` で適用すると、
スキーマの内容を変更せずコンテナーマイグレーションを追加できます。
生成 CRUD が必要な場合のみ plan/apply scaffold を使います。`--api-only` は UI を省略するだけで、CRUD は生成します。
pnpm を使う場合は `npx` を `pnpm exec` に置き換えます。

model-infrastructure の plan/apply は、登録済みコンテナーの場合も、
現在のすべてのモデルに合わせて `.swallowkit/project.json` を同期します。
メタデータだけを修復する場合は、`model <existing-model> --overwrite never` を plan し、
確認後に apply してください。スキーマがすべて省略されてもプロジェクト情報ファイルは更新されます。
CRUD 生成、インフラの書き換え、Azure 接続は不要です。

マイグレーション生成後にパーティションキーを変更した場合は、
`npx swallowkit machine plan model-infrastructure <model> --refresh-pending --resource-group <name>`
で、未適用の定義を更新する計画を明示的に作成します。読み取り専用のリモート確認を行い、
適用済み・デプロイ試行済み・状態不明・手編集済みのマイグレーションは拒否します。
dry-run とローカルのモデル生成は Azure のリソースの作成・更新を行いません。

モデル、インフラ、生成物、記録からのずれを検査し、`machine verify project` を実行してください。
モデルのコンテナー名・パーティションキーと Bicep、マイグレーション台帳、生成台帳の対応を確認します。
既存初期インフラの接続や外部コネクターの対応も、該当する場合は検証してください。
`--skip-infra` などで生成を延期する場合は、理由と未完了事項を明示します。
verify が通っても、必要なインフラがない状態で完了扱いやデプロイ可能という案内をしてはなりません。
ローカルでの生成は Azure リソースの作成・更新の許可ではありません。

### エージェントへの依頼例

モデル変更は、生成ファイルごとの修正ではなく、実現したい振る舞いとして依頼します。

> Todo に優先度を追加してください。このプロジェクトの AGENTS.md と関連するスキル／作業手順を読み、
> 選択済みのパッケージマネージャーを維持してください。編集前に所有権と記録とのずれを確認し、
> モデルを変更したら scaffold の Plan を作成してください。変更対象と競合を確認して Apply し、
> verify と優先度の振る舞いを確認するテストまで実施してください。
> 手編集の上書きなど判断が必要な場合は、対象の差分と選択肢を示してください。

ここでの **Plan は SwallowKit が返す変更計画**です。エージェントの文章による作業計画や
Plan モードとは別で、生成対象・競合・`planId` を持ちます。Plan は生成対象を変更しませんが、
計画自体は `.swallowkit/state/plans/` に保存します。内容を確認した Plan の `planId` を
Apply に渡してください。

`stale-plan` が返ったら、計画時に記録したファイルが変更されています。現在の差分を調べ、
Plan を作り直して再確認します。`--approve` は古い Plan を有効にするオプションではありません。
`requires-human` の場合は、求められた判断を確認してから進めます。
競合のない通常の変更に、一律の追加承認手順を設ける必要はありません。

### ドリフトが見つかったとき

ドリフトは、モデル・生成時の記録・現在のファイルなどの間のずれです。
`machine inspect drift` の検出結果にある種類、重要度、`repairAction` と、
`machine inspect boundaries` の編集ポリシーを合わせて確認します。
検出結果があるだけで、すべてを上書きする必要があるとは限りません。

| 検出結果 | エージェントが確認すること |
| --- | --- |
| `schema-drift` | 意図したモデル変更か確認し、対象モデルの scaffold を Plan → Apply します。 |
| `artifact-modified` | 生成後の差分と所有権を確認します。ユーザー編集が認められる領域の変更は正常な場合があります。必要なカスタマイズを消さないでください。 |
| `artifact-missing` | 削除が意図したものか確認し、必要な生成物を再生成します。 |
| `generator-drift` | 生成時と実行中の SwallowKit のバージョンを確認し、更新を採用する場合は再生成の差分をレビューします。 |
| `manifest-drift` | 実際のプロジェクト構造と記録のずれを調べ、提示された `repairAction` に従います。 |

MCP は既定で `latest`、通常の CLI はプロジェクトに固定されたバージョンを使います。
`latest` より新しいプレリリース版のプロジェクトでは、MCP をプロジェクトの版に固定するか、プロジェクトにインストールされた MCP に委譲します。MCP の応答の `metadata.swallowkitVersion` で確認してください。
バージョン差がある場合は同じ環境だと決めつけず、各インターフェースの現在の機能を確認してください。
Plan と Apply は同じプロジェクト・同じバージョンの実行経路で行います。
MCP のバージョン指定は[パッケージマネージャーガイド](./package-managers.md)を参照してください。

修復後は `machine verify project` を実行し、失敗時は `machine explain failure` の証拠を
確認します。ドリフトが解消しても、依頼した機能の振る舞いや Azure デプロイの成功まで
証明されたわけではありません。それぞれのテスト・実行結果で確認してください。

## 構造の検証と仕様のレビュー

SwallowKit の検証では、プロジェクトの構造、管理対象の生成物のずれ、設定されたチェックの結果を調べます。
一方、設計・仕様のレビューでは、実際の動作が利用者の目的と受け入れ条件を満たすかを確かめます。

実装、SwallowKit の検証、設計・仕様のレビューの順に進めます。
検証に失敗した場合は `machine explain failure` または対応する MCP ツールで原因を調べ、定義元を直して再検証してください。

## 人による承認

machine 操作は処理の終了・継続状態と `nextActions` を返します。`requires-human` は意図的な
停止であり、回避すべきエラーではありません。エージェントは指定された判断を人間に求め、
承認を捏造してはなりません。

Azure リソースの作成・更新は常に `swallowkit-provision` スキル/作業手順書と明示的承認が必要な手順を
利用します。デプロイ完了までという広い依頼であっても、plan 提示後に必要となる承認が
暗黙に付与されたことにはなりません。

## 外部開発プロセスとの組み合わせ

要件整理、仕様作成、チケット管理、TDD、実装、レビューを進める外部ツールから、SwallowKit の検査・生成処理を呼び出せます。
独自のスキル、Spec Kit、GSD、BMAD を使う場合も、Codex、Claude Code、GitHub Copilot に直接作業を依頼する場合も、同じように組み合わせられます。

### 例: Matt Pocock スキル

以下は組み合わせて使う例です。連携を保証するものではなく、SwallowKit の依存パッケージでもありません。

```text
grill-with-docs
    ├─ プロジェクト、モデル、ルート、編集規則を検査
    ├─ リポジトリから分かることを確認
    └─ 製品や業務の仕様に関する判断を人に質問
    ↓
to-spec
    ├─ 目的と、利用者が確認できる動作を記述
    ├─ SwallowKit の構成と所有権を条件に含める
    └─ 生成するレイヤーを別々の手作業として数えない
    ↓
to-tickets
    ├─ 独立して実装・検証できる機能単位に分割
    └─ スキーマ、API、BFF、UI、インフラの生成を同じ作業に含める
    ↓
implement
    ├─ 編集規則を検査
    ├─ ai-authored → 通常の実装・TDD
    ├─ deterministic → SwallowKit plan/apply
    ├─ shared → パスごとの編集規則に従う
    └─ SwallowKit verify
    ↓
code-review
    └─ 機械的な検証の後に、設計・仕様・実装をレビュー
```

Matt Pocock スキルと SwallowKit はそれぞれを呼び出して組み合わせて使えます。これらのスキルのインストール、取り込み、複製、書き換えを SwallowKit が行うわけではありません。

## 生成される指示ファイルの全文

以下は `swallowkit init` が利用する完全な英語テンプレートであり、抜粋ではありません。
`{{projectName}}`、`{{backendLanguageLabel}}`、`{{functionsStructureLine}}`、
`{{backendRules}}`、`{{pm}}`、`{{runCmd}}` は選択したプロジェクトに合わせて展開されます。
このページは生成用テンプレートを直接読み込むため、掲載する英語の原文はジェネレーターが使う内容と一致します。

## 生成される AGENTS.md

### 生成される英語の原文

<<< ../../src/core/project/agent-templates/AGENTS.md{md}

### 日本語対訳

<<< ./generated-agent-docs/AGENTS.ja.md{md}

## 生成される CLAUDE.md

### 生成される英語の原文

<<< ../../src/core/project/agent-templates/CLAUDE.md{md}

### 日本語対訳

<<< ./generated-agent-docs/CLAUDE.ja.md{md}

## 生成される .github/copilot-instructions.md

### 生成される英語の原文

<<< ../../src/core/project/agent-templates/copilot-instructions.md{md}

### 日本語対訳

<<< ./generated-agent-docs/copilot-instructions.ja.md{md}
