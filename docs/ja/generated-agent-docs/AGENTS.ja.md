# AGENTS.md

通常の `swallowkit provision` は人が直接使うデプロイコマンドであり、追加の確認なしで実行します。エージェントは machine／MCP の承認フローを使い、通常 CLI に切り替えて承認を回避してはいけません。

このプロジェクトは **SwallowKit** によって生成されました。

SwallowKit の構成と編集規則は、コード生成時だけでなく、調査、要件整理、仕様作成、計画、チケット分割、実装、検証、レビューのすべてで守ってください。

<!-- source-section: How SwallowKit Fits Into the Development Process -->
## SwallowKit と開発プロセスの関係

SwallowKit は開発プロセス全体の進め方を決めるものではありません。
利用者や別の Agent Skill、フレームワークが要件整理、仕様作成、計画、チケット管理、TDD、実装、レビューの手順を定めている場合は、その手順に従ってください。

その中で SwallowKit を使い、現在のプロジェクト、モデル、ルート、インフラ、責任範囲を調べます。
編集可能な生成物を判断し、plan/apply によって同じ定義から生成物を再現し、記録とのずれを検出して検証します。
人の承認が必要な操作では、定められた承認手順に従ってください。

開発プロセスのスキルが作業の進め方を定め、SwallowKit がプロジェクトの検査と再現可能な変更方法を担います。両方を組み合わせて使用してください。

<!-- source-section: Do Not Assume SwallowKit Capabilities From Memory -->
## 現在利用できる機能の確認

SwallowKit の機能はバージョンによって変わります。エージェントが学習した知識や記憶だけで、生成できるもの・できないものを判断してはいけません。
利用できる機能、プロジェクト構成、所有権が設計に影響する場合は、判断の前に現在のプロジェクトとツールを検査してください。

利用できる場合は `swallowkit_*` MCP ツールを優先します。MCP が使えない場合は machine CLI を使ってください。

```bash
{{runCmd}} swallowkit machine ...
```

machine CLI は `status` と `nextActions` を構造化された形式で返し、エージェントが次の操作を判断するために使えます。

<!-- source-section: Inspect Before Asking or Designing -->
## 質問・設計の前の検査

SwallowKit 管理の構成に影響する作業では、人に質問したり実装の設計を確定したりする前にプロジェクトを調べてください。
タスクに関連する検査を選びます。

```bash
{{runCmd}} swallowkit machine inspect project
{{runCmd}} swallowkit machine inspect entities
{{runCmd}} swallowkit machine inspect routes
{{runCmd}} swallowkit machine inspect boundaries
{{runCmd}} swallowkit machine inspect drift
{{runCmd}} swallowkit machine inspect infra
{{runCmd}} swallowkit machine inspect capabilities
```

`inspect capabilities` では、対応するモデル宣言の書式、認証の導入手順、生成 CRUD の範囲、シードの適用方法を確認できます。
機能を推測したり SwallowKit 内部の実装を検索したりする前に、この情報を使います。対応する MCP ツールが利用できる場合は、そちらを優先してください。

リポジトリや検査結果から分かることはエージェントが確認します。
たとえば、生成 CRUD の接続方法、生成ファイルを編集できるかどうか、必要なインフラ操作があるかどうかを、検査せずに人へ質問してはいけません。

<!-- source-section: Specification and Planning Guidance -->
## 仕様と計画

仕様には、利用者から確認できる動作と業務上の目的、受け入れ条件、テストで確かめる動作を記載します。
SwallowKit の構成と責任範囲は実装上の制約として扱い、モデルや設定から生成できるものを、手作業で実装する部品として重複して計画してはいけません。

たとえば、モデルにフィールドを追加して Functions、BFF、UI、インフラを再生成する場合は、その機能全体の期待動作と必要な制約を仕様に記載します。
各レイヤーが別々の手作業であるかのように扱わないでください。
目的の動作を SwallowKit が生成できるかによって仕様が変わる場合は、確定する前に現在の機能を検査します。

<!-- source-section: Ticket Decomposition Guidance -->
## チケット分割

単独で価値があり、実装・検証できる機能単位でチケットを作成してください。
スキーマ、バックエンド、BFF、UI、インフラの生成先が違うという理由だけで、レイヤー別のチケットに分割してはいけません。
1つの機能をモデルから再生成できる場合は、同じチケットに含めます。

```text
Todo に優先度を追加
  ├─ 定義元のモデルを変更
  ├─ plan/apply で生成物を更新
  ├─ 必要な独自の業務ロジックを実装
  ├─ テストを追加・更新
  └─ プロジェクトを検証
```

チケットの範囲は、生成先のディレクトリではなく、独立して価値と動作を確認できる単位で決めてください。

<!-- source-section: Responsibility Boundary -->
## 責任範囲と編集規則

編集するファイルを決める前に、現在の編集規則を取得してください。

```bash
{{runCmd}} swallowkit machine inspect boundaries
```

ここで返される現在の契約に従います。以下の例だけで編集可否を決めてはいけません。

### ai-authored

モデルの定義元、独自の業務ロジック、独自のページ・コンポーネント、テストなど、直接編集できる領域です。

### deterministic

SwallowKit が管理する生成物です。直接編集せず、モデルや設定を変更して plan/apply で再生成してください。
管理対象は `.swallowkit/artifacts.json` などに記録されています。

### shared

パスごとの `editPolicy` に従ってください。マーカーで管理するファイルでは、その外側を編集します。
`shared/index.ts` はマーカーがなく、必要なエクスポートを手動で追記できます。

<!-- source-section: Deterministic Changes: Plan → Apply → Verify -->
## 定義に基づく変更の手順

エージェントによる生成では、計画と適用を分ける SwallowKit の手順を優先してください。
現在の状態を検査し、plan を作り、競合と承認の要否を確認してから apply し、最後に verify します。

```bash
{{runCmd}} swallowkit machine plan scaffold <model>
{{runCmd}} swallowkit machine apply scaffold --plan <planId>
{{runCmd}} swallowkit machine verify project
```

生成物の手編集で plan/apply を迂回してはいけません。
競合が見つかった場合は、既存の手書き処理を直接編集できる場所へ移すか、上書きの承認を得るかを判断してください。
人の承認が必要な場面で、承認を捏造したり、暗黙に得たと解釈したりしてはいけません。

<!-- source-section: Model Changes -->
## モデルの変更

既存モデルは、次の順序で変更します。

```text
source-of-truth model を編集
        ↓
drift を inspect
        ↓
scaffold を plan
        ↓
conflict / approval を必要に応じて解決
        ↓
apply
        ↓
verify
```

利用可能なら `swallowkit-modify-model` Agent Skill を使用してください。

それ以外では `.swallowkit/workflows/` にある同等の作業手順書を読み、従ってください。

SwallowKit 管理の生成物を直接修正してスキーマと記録のずれを修復してはなりません。

モデル変更に関する追加事項:

- 共有パッケージはビルド済み `dist/` 経由で参照されます。`verify project` は型検査の前に
  自動で再ビルドしますが、手動で型検査する場合は先に共有パッケージをビルドしてください
  (古い `dist/` は "no exported member" エラーとして現れます)。
- 開発用シードは、次の手順でモデルの変更に追従させてください。

### 開発用シードデータ

`dev-seeds/<environment>/` を使い、
`{{runCmd}} swallowkit dev --seed-env <environment>` で明示的に適用します。
JSON の編集だけでは適用されません。このコマンドは対象コンテナーのデータを置換するため、
実行前に「日常的なコマンド」の対象確認と承認規則に従ってください。

シードファイル名は、複数形の Cosmos コンテナー名ではなく、モデル名の単数形 kebab-case です。
`LearningProfile` なら `LearningProfiles.json` ではなく
`dev-seeds/<environment>/learning-profile.json` を使います。
モデルに合うフィールドを持つ、トップレベルのドキュメント配列の例:

```json
[
  { "id": "profile-1", "learnerId": "learner-1", "displayName": "Example" }
]
```

意図したモデルを、実効 DB 名とログに出るシードファイル名、コンテナー、挿入件数に
照合してください。全ファイルの省略、対応スキーマなし、対象ファイルなしは、
シードの適用成功を示しません。

HTTP リクエスト、バックエンド起動、DB が空であることを契機にデモデータを自動投入しては
なりません。独自の reset API / UI、importer、demo フラグでこの手順を置き換えてはなりません。
標準のシードファイルを出力し、バックエンドから呼ばれないオフラインのテスト用データの生成は可能です。
正当な業務上の初期化はデモ用シードとは別です。必要なドメイン動作は削除しないでください。

<!-- source-section: New Models / CRUD Features -->
## 新しいモデルと CRUD 機能

利用可能なら `swallowkit-add-model` Agent Skill を使用してください。

それ以外では `.swallowkit/workflows/` の同等の作業手順書に従ってください。

エージェントは 業務に固有のスキーマフィールドと独自の動作を記述できますが、SwallowKit 管理の
CRUD 生成物は SwallowKit が生成すべきです。

SwallowKit が所有する 定型コード を手作業で再作成してはなりません。

### カスタム API の有無にかかわらず、永続化モデルにはインフラ生成が必要

永続化モデルを追加するときは、カスタム API の有無にかかわらず、インストールされている
SwallowKit のモデル作成・インフラ生成手順を実行してください。手書きモデルを追加しただけでは完了ではありません。

1. `{{runCmd}} swallowkit machine plan model <model> --overwrite never` で
   定義元のスキーマ、共有パッケージのエクスポート、Cosmos コンテナーマイグレーション、プロジェクト情報ファイル、
   生成台帳の書き込み予定を確認し、返された plan を
   `{{runCmd}} swallowkit machine apply model --plan <planId>` で適用します。
   plan は apply 前に生成ファイルを書き込みません。
   `shared/models/` にドメインのフィールドを記述し、`shared/index.ts` のエクスポートを確認してください。
   手書きスキーマやテンプレートをスキップしたモデルは、
   `{{runCmd}} swallowkit machine plan model-infrastructure <model>` で確認後、
   返された plan を `{{runCmd}} swallowkit machine apply model --plan <planId>`
   で適用してください。スキーマを変更せず既存モデルにインフラ定義を追加できます。
   登録済みコンテナーの場合も、現在のすべてのモデルに合わせて `.swallowkit/project.json` を同期します。
   メタデータだけを修復する場合は、`model <existing-model> --overwrite never` を plan し、
   確認後に apply してください。省略されたスキーマは保持されます。
   CRUD 生成、インフラの書き換え、Azure 接続は不要です。
2. 生成 CRUD が必要なら `machine plan scaffold <model>` →
   `machine apply scaffold --plan <planId>` で Functions、BFF、UI、必要な OpenAPI／ネイティブスキーマ
   生成ファイルを生成します。`--api-only` は UI だけを省略し、
   CRUD Functions と BFF ルートは生成します。
   カスタム API が CRUD を置き換える場合、不要な CRUD を scaffold してはなりません。
   手順 1 で生成したマイグレーション（または既存モデルへのインフラ定義の追加）だけで十分です。
3. `machine inspect entities`、`machine inspect infra`、`machine inspect artifacts`、
   `machine inspect drift` で確認し、`{{runCmd}} swallowkit machine verify project` を実行します。
   モデルのコンテナー名・パーティションキーが、`infra/migrations/` の Bicep、
   `infra/migrations/manifest.json` の `sourceModel`、`.swallowkit/artifacts.json` と対応することを確認してください。
   初期インフラが管理する既存コンテナーでは新規マイグレーションが不要な場合があります。
   その場合は追跡済みの定義と `infra/main.bicep` の接続を確認してください。
   外部 `connectorConfig` モデルは Cosmos DB ではなく設定済みのコネクターを使うため、
   Cosmos コンテナーを追加せず、その対応を検証してください。

コンテナー追加のためにチェックサムで保護された初期インフラや既存マイグレーションを手編集してはなりません。
現在のマイグレーション手順を使用してください。生成はローカル操作であり、Azure リソースの作成・更新ではありません。
デプロイには後述のリソースの作成・更新に関する承認手順が引き続き適用されます。

インフラ生成を延期する場合は、理由と未完了のコンテナー／マイグレーション作業を明示してください。
CRUD では `plan scaffold` / `apply scaffold` に `--skip-infra` (MCP は `skipInfra: true`) を指定します。
`infra/` は変更されず、plan は `infra-skipped` を返します。
手書き・スキップしたモデルでマイグレーションが未登録なら、後で
`{{runCmd}} swallowkit machine plan model-infrastructure <model>` で変更予定を確認し、
返された plan を `{{runCmd}} swallowkit machine apply model --plan <planId>`
で適用してください。パーティションキーの変更後に未適用のマイグレーションを更新する場合も、
`{{runCmd}} swallowkit machine plan model-infrastructure <model> --refresh-pending --resource-group <name>`
で明示的に変更予定を確認します。
この読み取り専用確認では対象のマイグレーションタグとデプロイ履歴を検証します。
適用済み・デプロイ試行済み・状態不明・手編集済みのマイグレーションは書き換えられません。
`verify project` が通っても、必要なインフラがない状態で永続化モデルを完了扱いにしたり、
デプロイ可能と案内したりしてはなりません。

<!-- source-section: Authentication -->
## 認証

認証は plan/apply で導入します。設定ファイルで編集できる項目は、次のように分かれます。

- `auth.schemes` は SwallowKit が管理します。`{{runCmd}} swallowkit machine plan auth --provider <p> [--scheme <name>]` から始め、返された plan を `apply auth` で適用してください。先にスキームを手書きすると、既存スキームとして扱われ、plan が `already exists` で停止します。
- `auth.authorization.policies` と `swa.allowedProviders` は apply 後に追記します。SWA のプロバイダーは plan 時に `--allowed-providers github,aad` でも指定できます。

適用後は `nextActions` に従ってください。

1. 追加したスキームを参照する認可ポリシーを定義します。
2. SWA では `swa.allowedProviders` を確認します。生成されるログイン URL はこの値を使います。
3. 外部トークンでは、生成された検証処理のひな形を実装します。ひな形はすべてのトークンを拒否します。未実装でも `verify project` は警告 `auth-verifier-stub` を表示して成功する場合があり、認証の動作確認の代わりにはなりません。
4. 認証・認可が必要なモデルを plan/apply scaffold で再生成し、検証します。

利用できる場合は `swallowkit-add-auth` Agent Skill、使えない場合は `.swallowkit/workflows/add-auth.md` の手順書に従ってください。

### 生成 CRUD が制御する範囲

生成 CRUD はモデルの `authPolicy` による認証とロールを検査しますが、利用者ごとのデータ所有権は制御しません。ポリシーを満たした呼び出し元は、任意のドキュメントを操作できます。
自分のレコードだけを操作させる場合は、検証済みの利用者情報から `learnerId` などの対象キーを取得する独自 API を作成してください。対象キーをリクエスト本文から信用して取得してはいけません。生成された書き込み API は管理者ロールに制限します。

`authPolicy` の宣言前に plan/apply auth で認証を設定してください。未設定のまま明示的なポリシーを宣言すると、書き込み前に `auth-policy-without-auth` で停止します。空の `{}` は明示的なポリシーなしと解釈し、認証を有効にしません。
名前付きスキームでは、`authPolicy.policy` または `read`／`write` で名前付きポリシーを参照します。ロールだけの宣言は `auth-policy-requires-named-policy` で停止します。
旧形式の単一 `auth.provider` ではロール配列を使います。名前付きポリシーや名前付きの `defaultPolicy` は `auth-named-policy-requires-named-scheme` で停止します。

<!-- source-section: Verification Is a Completion Gate -->
## 完了前に必要な検証

エージェントによる実装を完了とみなす前に SwallowKit の検証を実行してください。

```bash
{{runCmd}} swallowkit machine verify project
```

または同等の MCP 操作を使用します。

既定チェックは `structure` / `drift` / `typecheck` / `backend-build` と設定済みの
カスタムチェックです。`backend-build` は独立 `functions/` を検証します。
C# は `dotnet build`、TypeScript はプロジェクトの `tsc --noEmit`、
Python 3 は `compileall`（構文のみ。インポートや型は対象外）で、Python は
PATH より `functions/.venv` を優先します。ツールチェーンがなければ理由付きで
省略になります。省略はバックエンドの検証成功ではありません。復元して再実行してください。
本番フロントエンドビルドも含める場合は
`--checks "structure,drift,typecheck,backend-build,build"` を指定します。
PowerShell ではカンマ区切り値を引用符で囲みます。

検証が失敗した場合は失敗した検査の構造化された結果を使用します。

```bash
{{runCmd}} swallowkit machine explain failure
```

または対応する MCP ツールを使用し、適切な定義元を修復して再検証します。

該当する場合は `swallowkit-verify-repair` Agent Skill または作業手順書を使用してください。

SwallowKit の検証が答える問い:

> SwallowKit プロジェクトは構成・構造の規則を満たしているか？

設計と仕様に照らしたコードレビューが答える別の問い:

> この実装は適切に設計されているか？
> 仕様と利用者の目的を満たすか？

したがって、設計と仕様に照らしたコードレビューを完了の条件とする前に SwallowKit の検証を
実施し、以下で必要とされる実動作の証拠も確認してください。

### 変更した動作の実行時の証拠

検証、ビルド、型検査、単体テスト、テスト用データ、起動確認は機械的な証拠であり、
実 DB への接続や E2E 動作の証明ではありません。起動・永続化・API・UI の変更では、通常の
`{{runCmd}} swallowkit dev` を実行し、実アプリから、設定されたフロントエンドの同一オリジン BFF、
独立 Functions、DB を通して変更した動作を確認してください。
「日常的なコマンド」のフロントエンド別ルーティングに従います。
Functions の直接呼び出しでは BFF や UI は検証できません。

永続化の変更ではアプリから書き込み、再読み込みして読み戻し、
再シードせずにアプリを再起動してデータが残ることを確認します。
正常系だけでなく、関連する入力検証エラー、存在しない ID、設定された認証・認可も確認してください。

Emulator / Azure Cosmos DB、模擬 AI / 実 AI サービス呼び出し、
開発用の固定 ID / 実認証、および成功 / 省略 / 警告を分けて報告します。
API 成功はホストの健全性を意味しません。HTTP 成功で `AzureWebJobsStorage` の警告が
解消したことにはなりません。サービス、資格情報、コンテナー、ツールの不足は作業を進められない理由または
未検証事項です。無関係なテストの成功を根拠に完了を宣言してはなりません。

ドキュメントだけの変更には実 DB の検証は不要です。

<!-- source-section: Human Approval Gates -->
## 人の承認が必要な操作

machine 操作は次のような処理の終了・継続状態を返す場合があります。

- `complete`
- `in-progress`
- `blocked`
- `requires-human`
- `failed`

`nextActions` に従ってください。

状態が `requires-human` の場合は停止し、必要な人による判断を要求してください。

`requires-human` を回避すべきエラーと解釈してはなりません。

Azure リソースの作成・更新は人の承認が必要な操作です。

`swallowkit-provision` Agent Skill または作業手順書を使用し、その承認が必要な手順を決して迂回しては
なりません。デプロイ全体を依頼されただけでは、その作業手順が要求する明示的承認を得たことにはなりません。

Provision は Bicep を一度送信し、元の Azure デプロイを時間を区切って確認します。
ローカルのタイムアウト／エラー、出力の省略、Ctrl+C は Azure の失敗を意味しません。
`in-progress` は Running／Accepted、`unknown` は結果を照会できない状態、
`partial` は Azure 成功後の tag／台帳未完了です。待機や記録の修復だけのために
Bicep を再送したり、reconcile／adopt／cancel／delete を実行したりしないでください。

`.swallowkit/state/provision/` の実行チェックポイントを保持し、
`{{runCmd}} swallowkit machine inspect provision --plan <runId> --wait-seconds 300`
で読み取り専用の状態確認／待機を行います。再度、人間の明示承認を得て
`{{runCmd}} swallowkit machine apply provision --plan <runId> --approve`
で再開してください。runId は元の planId と同じです。変更検出用のハッシュ、サブスクリプション、
デプロイの識別子、マイグレーションのチェックは引き続き有効です。
Azure Succeeded と tag／台帳の確認が完了した
`status: "complete"`／`outcome: "succeeded"` だけを全体の成功と扱ってください。
デプロイ出力値の秘密値や `az --debug` の生の出力を表示してはいけません。
旧版の未追跡初期インフラは、元の対象／リージョンと
`plan provision --resume-deployment <name>` を使い、ARM／parameters の一致を確認します。

<!-- source-section: SwallowKit Agent Skills and Runbooks -->
## Agent Skills と作業手順書

SwallowKit は、次の作業に対応する Agent Skills を `.github/skills/` に生成します。

- `swallowkit-add-model`
- `swallowkit-modify-model`
- `swallowkit-add-auth`
- `swallowkit-verify-repair`
- `swallowkit-provision`

Agent Skills に対応する実行環境では、作業に合うスキルを使用してください。
対応しない場合は、`.swallowkit/workflows/` にある同じ作業の手順書を読みます。
これらは作業ごとの詳細であり、すべての作業に適用する `AGENTS.md` の代わりではありません。

<!-- source-section: Architecture -->
## アーキテクチャ

このアプリケーションは、TypeScript のフロントエンド・BFF と、{{backendLanguageLabel}} の独立 Azure Functions バックエンドで構成され、Azure にデプロイされます。

```text
フロントエンド（{{frontendLabel}}）
  ↓
BFF（{{bffLabel}}）
  ↓
独立 Azure Functions
  ↓
Azure Cosmos DB
```

### 構成の基本規則

1. {{bffLabel}} はリクエストの検証と転送を担います。業務ロジックやデータベースへの直接アクセスを置いてはいけません。
2. `shared/models/` の Zod スキーマをモデルの定義元とします。
3. レイヤーごとにモデル定義を重複させてはいけません。
4. 業務ロジックとデータアクセスは、独立 Azure Functions が担当します。
5. SwallowKit 管理の生成物は直接編集せず、定義元と plan/apply から変更します。
6. インフラは Bicep で管理し、SwallowKit の所有権と編集規則に従います。
7. 本番の Azure リソースには生成された認証・接続の構成でアクセスします。資格情報や接続文字列をコードに直接記述してはいけません。
8. 独立 Functions を SWA にリンクしてはいけません。同一オリジンの BFF が `BACKEND_FUNCTIONS_BASE_URL` と `BACKEND_FUNCTIONS_KEY` をサーバー側で使用します。ブラウザーのバンドルや `VITE_*` には公開しないでください。マネージド Functions は HTTP 専用です。DB、非 HTTP トリガー、マネージド ID、閉域網は独立バックエンドが担当します。

### バックエンドごとの規則

{{backendRules}}

`id`、`createdAt`、`updatedAt` はバックエンドが管理します。クライアントが送信した値を信頼してはいけません。

### 永続化の規約

Cosmos を使うモデルでは、本番は Azure Cosmos DB、ローカルは Cosmos DB Emulator を使用します。
サービス、資格情報、コンテナーが不足している場合は報告してください。接続障害を隠すために、保存先を File / JSON / SQLite / InMemory に置き換えてはいけません。
単体テスト用の代替実装は使用できますが、実 DB を検証した証拠にはなりません。

カスタム API と業務ロジックでも、標準の接続設定と実効 DB 名を使います。
`swallowkit dev` が解決する worktree 分離後の DB 名もこれに含まれます。
分離前の DB 名を直接記述したり、不要な独自の DB・パス・ストレージ設定や本番用の起動フラグを追加したりしてはいけません。
別の永続化要件や外部の `connectorConfig` モデルを使う場合も、確認した機能と編集規則に従ってください。Cosmos の障害時に無断で保存先を置き換える許可ではありません。

<!-- source-section: Project Structure -->
## プロジェクト構成

```text
{{projectName}}/
{{frontendStructure}}
├── functions/              # 独立 Azure Functions バックエンド
{{functionsStructureLine}}
├── shared/
│   ├── models/             # 定義元の Zod モデル
│   └── index.ts
├── lib/                    # 認証、ナビゲーション、共通処理
├── components/
├── infra/                  # Bicep インフラ
├── .swallowkit/            # プロジェクト情報と作業手順書
├── .github/skills/         # SwallowKit の Agent Skills
├── .mcp.json               # MCP サーバーの起動設定
└── AGENTS.md
```

すべてのプロジェクトで同じファイル構成になるとは限りません。作業するプロジェクトを検査してください。

<!-- source-section: Naming and Model Conventions -->
## 命名とモデルの規約

- モデルのファイルは `shared/models/{kebab-case}.ts` に置きます。
- Zod の定数と推論した TypeScript 型は同じ PascalCase 名を使います。例は `export const Todo = z.object(...); export type Todo = z.infer<typeof Todo>` です。
- `create-model` と plan/apply scaffold は、手書きモデルを含め、不足するエクスポートを `shared/index.ts` に追記します。マーカーはなく、既存内容を保持し、手動での追記もできます。
- `id` は必須の `z.string()` です。バックエンド管理の `createdAt` と `updatedAt` は任意項目にできます。
- `partitionKey`、`authPolicy`、`displayName`、`connectorConfig` はエクスポートした定数で指定できます。正確な書式は `{{runCmd}} swallowkit machine inspect capabilities` の `modelDeclarations` を確認してください。
- Cosmos DB のコンテナー名は PascalCase の複数形です。パーティションキーの既定値は `/id` で、たとえば `export const partitionKey = '/learnerId';` で変更できます。指定するフィールドはスキーマ内に定義してください。

<!-- source-section: Everyday Commands -->
## 日常的なコマンド

```bash
{{pm}} install
{{runCmd}} swallowkit dev
{{pm}} run build
{{pm}} run --if-present lint
{{runCmd}} swallowkit machine verify project
```

このプロジェクト向けに生成された package-runner convention で SwallowKit を呼び出してください。
package-manager invocation style を勝手に混在させてはなりません。

{{devGuidance}}

ローカルサービスを起動する前に、既存の Emulator / サーバープロセスと使用中のポートを
調べてください。DB の検証前に Emulator の稼働を確認し、利用できなければ報告します。
明示的な許可なく起動・再起動・リセットしてはなりません。
ポートを空けるために利用者のサービスを再起動してはなりません。

破壊的なシード置換、コンテナー再作成、その他のデータ変更の前に、
実際のエンドポイント、実効 DB 名、対象コンテナーを確認します。分離したテスト DB とポートを使い、
worktree 内にいるというだけで分離済みと判断せず、解決済みの設定とログで確認します。
本番・共有・既存の利用者データには適用される人間の承認が必要です。破棄可能と決めつけてはなりません。
検証を通すために TLS 検証を無効化したり、証明書の信頼設定・グローバルツール・PC の設定を
変更したり、別プロトコルを推測して使ってはなりません。
実際に設定された HTTP / HTTPS エンドポイントを使い、接続障害は報告してください。

停止するのは自分が起動したプロセスだけにし、個々のプロセスを特定してください。
プロセス名による一括停止は禁止です。ローカルの未追跡設定やテスト DB の残存を報告します。
上記の実動作確認の gate に従い、クラウド未検証や利用できないローカル前提条件を明示してください。

<!-- source-section: Final Rules -->
## 最終ルール

次の操作をしてはいけません。

- 現在の検査結果で分かる機能を、記憶だけで判断する。
- SwallowKit 管理の生成物を手編集する。
- plan/apply の検査や、人の承認が必要な手順を迂回する。
- 生成されるレイヤー間でモデル定義を重複させる。
- バックエンドの業務ロジックを BFF に移す。
