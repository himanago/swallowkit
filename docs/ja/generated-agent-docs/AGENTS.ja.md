# AGENTS.md

このプロジェクトは **SwallowKit** によって生成されました。

SwallowKit は、このプロジェクトのアーキテクチャおよび開発ワークフローの一部です。
コード生成時だけでなく、discovery、requirements clarification、specification、planning、
ticket decomposition、implementation、verification、review の間、常に適用される制約として
扱わなければなりません。

<!-- source-section: How SwallowKit Fits Into the Development Process -->
## SwallowKit と開発プロセスの関係

SwallowKit はソフトウェア開発プロセス全体を所有**しません**。

ユーザー、別の Agent Skill、または framework が requirements discovery、specification、
planning、ticketing、TDD、implementation、review のプロセスを定義している場合は、
そのプロセスに引き続き従ってください。

以下については、SwallowKit を authoritative な project-specific layer として使用してください。

- 現在のプロジェクトの検査
- entity、route、infrastructure、responsibility boundary の理解
- 直接編集できる artifact の判定
- plan/apply による deterministic generation
- drift の検出
- 生成後のプロジェクトの検証
- sensitive operation に対する human approval gate の強制

外部の development-process Skill と SwallowKit は合成して使用することを意図しています。

process Skill は**どのように進めるか**を決定します。
SwallowKit は**この SwallowKit project をどのように安全かつ再現可能に変更できるか**を決定します。

<!-- source-section: Do Not Assume SwallowKit Capabilities From Memory -->
## 記憶から SwallowKit capability を推測してはならない

SwallowKit は時間とともに進化します。

SwallowKit が生成できるもの・できないものについて、モデルが保持する知識や仮定に
依存してはなりません。

SwallowKit capability、project structure、ownership boundary が設計判断に影響する場合、
判断前に現在のプロジェクトと現在利用可能な SwallowKit interface を検査してください。

利用可能な場合は `swallowkit_*` MCP tools を優先してください。

MCP を利用できない場合は machine interface を使用します。

```bash
{{runCmd}} swallowkit machine ...
```

machine interface は Agent-facing fallback であり、自律 workflow に適した構造化済みの
`status` / `nextActions` を返します。

<!-- source-section: Inspect Before Asking or Designing -->
## 質問または設計の前に検査する

タスクが SwallowKit-managed application structure に影響する可能性がある場合、
人間に質問したり実装設計を確定したりする前にプロジェクトを検査してください。

タスクに関係する inspection だけを使用してください。典型的な inspection は次のとおりです。

```bash
{{runCmd}} swallowkit machine inspect project
{{runCmd}} swallowkit machine inspect entities
{{runCmd}} swallowkit machine inspect routes
{{runCmd}} swallowkit machine inspect boundaries
{{runCmd}} swallowkit machine inspect drift
{{runCmd}} swallowkit machine inspect infra
```

利用可能な場合は同等の `swallowkit_*` MCP tools を使用してください。

repository または SwallowKit inspection から回答できる質問は、人間に委ねず Agent が
回答しなければなりません。

例:

- SwallowKit が generated CRUD layer を定義・生成している場合、その wiring 方法を質問しない。
- responsibility boundary を確認する前に generated file の編集を提案しない。
- current SwallowKit project と available operation を検査する前に、infrastructure capability が
  利用できないと仮定しない。

<!-- source-section: Specification and Planning Guidance -->
## Specification と planning のガイダンス

specification を作成または改善する場合:

- user-visible behavior と domain intent を記述する
- acceptance criteria と重要な test seam を定義する
- SwallowKit architecture と responsibility boundary を implementation constraint として扱う
- generated artifact を手動実装 component として早計に記述しない
- SwallowKit が source of truth から決定論的に導出できる作業を重複させない

例えば、model field の追加により SwallowKit が backend、BFF、UI、infrastructure artifact を
再生成する場合、specification は主に期待する end-to-end behavior と SwallowKit constraint を
記述すべきです。

各 generated layer が独立した manual implementation decision であると示唆すべきではありません。

SwallowKit が望む behavior をサポートするかどうかが specification に影響する場合、
spec を確定する前に current capability を検査してください。

<!-- source-section: Ticket Decomposition Guidance -->
## Ticket decomposition のガイダンス

独立して検証可能な user/system behavior の **vertical slice** を優先してください。

artifact が別 layer に存在するという理由だけで、作業を次のような horizontal ticket に
分割してはなりません。

- schema ticket
- backend ticket
- BFF ticket
- UI ticket
- infrastructure ticket

SwallowKit がそれらの layer を決定論的に生成し、1つの end-to-end behavior を表す場合は、
同じ vertical slice 内に保持してください。

例:

```text
Todo に priority support を追加
  ├─ source-of-truth model を更新
  ├─ SwallowKit plan/apply で managed artifact を再整合
  ├─ 必要な ai-authored business logic を追加
  ├─ test を追加/更新
  └─ project を verify
```

ticket boundary は SwallowKit の generated file structure ではなく、独立して価値があり検証可能な
behavior を反映すべきです。

<!-- source-section: Responsibility Boundary -->
## Responsibility boundary

file-level implementation decision の前に、current machine-readable boundary contract を
検査してください。

```bash
{{runCmd}} swallowkit machine inspect boundaries
```

その時点の結果を authoritative として扱ってください。

一般的な ownership model は次のとおりです。

### ai-authored

Agent はこれらを直接編集できます。

典型例:

- source-of-truth model
- custom business logic
- custom page/component
- test

### deterministic

これらの artifact を手編集してはなりません。

SwallowKit が生成・所有します。適切な source of truth または configuration を変更してから、
SwallowKit plan/apply で再生成してください。

managed artifact は `.swallowkit/artifacts.json` などの SwallowKit metadata で追跡されます。

### shared

SwallowKit-managed marker の外側だけを編集してください。

この文書の例だけに依存せず、常に current boundary contract を検査してください。

<!-- source-section: Deterministic Changes: Plan → Apply → Verify -->
## Deterministic change: Plan → Apply → Verify

自律または Agent-driven generation では SwallowKit の two-phase workflow を優先してください。

```text
inspect
   ↓
plan
   ↓
conflict / approval requirement を評価
   ↓
apply
   ↓
verify
```

例:

```bash
{{runCmd}} swallowkit machine plan scaffold <model>
{{runCmd}} swallowkit machine apply scaffold --plan <planId>
{{runCmd}} swallowkit machine verify project
```

deterministic artifact を手編集して plan/apply を迂回してはなりません。

plan が conflict を報告した場合は、既存の hand-written behavior を ai-authored location に
移す必要があるか、overwrite approval が必要かを判断してください。

human approval を捏造したり暗黙に付与したりしてはなりません。

<!-- source-section: Model Changes -->
## Model change

既存 model の変更は通常、次の pattern です。

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

それ以外では `.swallowkit/workflows/` にある同等の runbook を読み、従ってください。

SwallowKit-managed artifact を直接 patch して schema drift を修復してはなりません。

<!-- source-section: New Models / CRUD Features -->
## 新しい model / CRUD feature

利用可能なら `swallowkit-add-model` Agent Skill を使用してください。

それ以外では `.swallowkit/workflows/` の同等の runbook に従ってください。

Agent は domain-specific schema field と custom behavior を記述できますが、framework-owned
CRUD artifact は SwallowKit が生成すべきです。

SwallowKit が所有する boilerplate を手作業で再作成してはなりません。

<!-- source-section: Verification Is a Completion Gate -->
## Verification は completion gate

Agent-driven implementation を完了とみなす前に SwallowKit verification を実行してください。

```bash
{{runCmd}} swallowkit machine verify project
```

または同等の MCP operation を使用します。

verification は SwallowKit structural correctness、drift、type correctness、configured project
check を対象とします。

verification が失敗した場合は structured failure explanation を使用します。

```bash
{{runCmd}} swallowkit machine explain failure
```

または MCP equivalent を使用し、適切な source を修復して再び verify します。

該当する場合は `swallowkit-verify-repair` Agent Skill または runbook を使用してください。

SwallowKit verification が答える問い:

> SwallowKit project は mechanically/structurally valid か？

semantic code review が答える別の問い:

> この implementation は適切に設計されているか？
> specification と user intent を満たすか？

したがって、semantic code review を最後の quality gate として扱う前に SwallowKit verification を
実施してください。

<!-- source-section: Human Approval Gates -->
## Human approval gate

machine operation は次のような terminal state を返す場合があります。

- `complete`
- `in-progress`
- `blocked`
- `requires-human`
- `failed`

`nextActions` に従ってください。

status が `requires-human` の場合は停止し、必要な human decision を要求してください。

`requires-human` を回避すべき error と解釈してはなりません。

Azure provisioning は human-approved operation です。

`swallowkit-provision` Agent Skill または runbook を使用し、その approval gate を決して迂回しては
なりません。広い deployment request 自体は、その workflow が要求する明示的 approval を
付与しません。

<!-- source-section: SwallowKit Agent Skills and Runbooks -->
## SwallowKit Agent Skills と runbook

SwallowKit は task-specific Agent Skills を次の場所にインストールします。

```text
.github/skills/
```

現在の workflow:

- `swallowkit-add-model`
- `swallowkit-modify-model`
- `swallowkit-verify-repair`
- `swallowkit-provision`

同等の agent-agnostic runbook は次の場所にあります。

```text
.swallowkit/workflows/
```

runtime が Agent Skills をサポートする場合、タスクに合う Skill を使用してください。
それ以外では対応する runbook を読んでください。

これらの task-specific instruction は `AGENTS.md` を補足します。always-on project contract を
置き換えるものではありません。

<!-- source-section: Architecture -->
## Architecture

これは TypeScript frontend/BFF と {{backendLanguageLabel}} の Azure Functions backend を持ち、
Azure に deploy される full-stack application です。

```text
Frontend (React / Next.js App Router)
  ↓
BFF (Next.js API Routes)
  ↓
Azure Functions
  ↓
Azure Cosmos DB
```

### Core architecture rules

1. Next.js API route は BFF/proxy layer です。application business logic や direct database
   access を置いてはなりません。
2. `shared/models/` の Zod schema が application model の source of truth です。
3. model definition を layer 間で重複させてはなりません。
4. Azure Functions が backend business logic と data access を所有します。
5. SwallowKit-generated artifact は手編集せず、source of truth と deterministic generation
   workflow から変更しなければなりません。
6. infrastructure は Bicep による code として管理されます。SwallowKit ownership marker と
   boundary を尊重してください。
7. production の Azure resource access は generated security architecture に従わなければ
   なりません。hard-coded credential または connection string を導入してはなりません。

### Backend-specific rules

{{backendRules}}

backend が `id`、`createdAt`、`updatedAt` を所有します。client-sent value を決して信頼しては
なりません。

<!-- source-section: Project Structure -->
## Project structure

```text
{{projectName}}/
├── app/                    # Next.js App Router
│   ├── api/                # BFF routes
│   └── {model}/            # generated/custom UI
├── functions/              # Azure Functions backend
{{functionsStructureLine}}
├── shared/
│   ├── models/             # Zod source-of-truth models
│   └── index.ts
├── lib/
│   └── api/
├── components/
├── infra/                  # Bicep infrastructure
├── .swallowkit/            # SwallowKit project metadata and runbooks
├── .github/skills/         # SwallowKit Agent Skills
├── .mcp.json               # project-scoped SwallowKit MCP bootstrap
└── AGENTS.md
```

すべての project がまったく同じ generated structure を持つと仮定せず、current project を
検査してください。

<!-- source-section: Naming and Model Conventions -->
## Naming と model convention

- Model schema file は `shared/models/{kebab-case}.ts` を使用します。
- Zod schema constant と inferred TypeScript type は同じ PascalCase name を使用します:
  `export const Todo = z.object(...); export type Todo = z.infer<typeof Todo>`。
- model を `shared/index.ts` から re-export します。
- source-of-truth schema で backend-managed field を optional にします。
- Cosmos DB container は PascalCase plural name を使用し、model が別の key を宣言しない限り
  partition key の default は `/id` です。

<!-- source-section: Everyday Commands -->
## 日常的な command

```bash
{{pm}} install
{{runCmd}} swallowkit dev
{{pm}} run build
{{pm}} run lint
{{runCmd}} swallowkit machine verify project
```

この project 向けに生成された package-runner convention で SwallowKit を呼び出してください。
package-manager invocation style を勝手に混在させてはなりません。

<!-- source-section: Final Rules -->
## 最終ルール

してはならないこと:

- current inspection で回答できる場合に、記憶上の SwallowKit capability に依存する
- deterministic SwallowKit-managed artifact を手編集する
- plan/apply safety check を迂回する
- human approval gate を迂回する
- generated layer 間で model definition を重複させる
- backend business logic を BFF に移す
- 複数の generated layer があるという理由だけで、1つの end-to-end SwallowKit-generated
  feature を人為的な horizontal ticket に分解する
- SwallowKit verification が成功する前に implementation を完了とみなす

行うこと:

- SwallowKit-dependent な設計仮定の前に inspect する
- 外部 development-process workflow を維持する
- SwallowKit を deterministic execution/verification layer として使用する
- specification を intent と observable behavior 中心に保つ
- vertical で独立して検証可能な slice を優先する
- final semantic review の前に verify する
