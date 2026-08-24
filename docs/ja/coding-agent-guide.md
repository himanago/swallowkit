# コーディングエージェントガイド

SwallowKit はコーディングエージェントの開発プロセスを置き換えません。
要件整理、仕様化、計画、TDD、実装、レビューと合成できる、プロジェクト検査、
決定論的な変更操作、責務境界、検証ガードレールを提供します。

machine/MCP のコマンドとレスポンス契約の詳細は
[AI / MCP 統合](./ai-mcp-guide.md)を参照してください。

## 目的

開発プロセス Skill は、作業を**どのように進めるか**を決定します。
SwallowKit は、現在のプロジェクトを**どのように安全かつ再現可能に検査・変更するか**を
決定する、プロジェクト固有の authoritative layer です。

```text
開発プロセス / エンジニアリングプラクティス
  例: process Skill、Spec Kit、GSD、BMAD、
      独自 Skill、通常の Agent interaction
                    │
                    │ intent / specification / task
                    ▼
             SwallowKit contract
                    │
        ┌───────────┼────────────┐
        │           │            │
     inspect     plan/apply     verify
        │           │            │
        └───────────┼────────────┘
                    ▼
       deterministic Azure application
```

SwallowKit は current-project inspection、deterministic artifact generation、
drift detection、structural verification、failure explanation、infrastructure
guardrail を担います。独自の要件、仕様、チケット、semantic review framework は
導入しません。

## 生成される Agent integration files

`swallowkit init` は、同じ大きな規約を Agent ごとに繰り返すのではなく、
階層化された integration を生成します。

| ファイル | 役割 |
| --- | --- |
| `AGENTS.md` | canonical always-on project contract |
| `CLAUDE.md` | `AGENTS.md` を参照する Claude Code adapter |
| `.github/copilot-instructions.md` | `AGENTS.md` を参照する GitHub Copilot adapter |
| `.github/instructions/*.instructions.md` | path/layer-specific rules |
| `.mcp.json` | project-scoped SwallowKit MCP bootstrap |
| `.github/skills/*/SKILL.md` | task-specific Agent Skills |
| `.swallowkit/workflows/*.md` | Agent-neutral fallback runbooks |

adapter 自身にも、`AGENTS.md` を読む前から SwallowKit を認識できる最低限の
always-on rule が含まれます。task-specific な詳細は Skills/runbooks に置き、
canonical contract を百科事典ではなく operational contract に保ちます。

## 開発ライフサイクル全体での SwallowKit

### Discovery と requirements clarification

実装詳細を人間に質問する前に、現在のプロジェクト、関連する entity、route、infra、
ownership boundary を検査します。repository や SwallowKit から判明する事実は Agent が
回答し、人間への質問は本物の product/domain decision に限定します。

### Specification

user intent、observable behavior、acceptance criteria、重要な test seam を記述します。
SwallowKit architecture と ownership は implementation constraint として扱い、
生成される各 layer を独立した手動実装 component として記述しません。

### Planning

capability や ownership が設計判断を変える場合は current interface を検査します。
学習時のモデル知識から SwallowKit capability を推測してはなりません。

### Ticket decomposition

独立して価値があり検証可能な vertical slice を優先します。1つのモデル変更から
schema contract、Functions、BFF、UI、infra が決定論的に導出される場合、それらは
同じ behavioral slice に含めます。

```text
Todo に priority support を追加
  ├─ source-of-truth model を変更
  ├─ managed artifact を plan/apply
  ├─ custom behavior と test を追加
  └─ project を verify
```

生成ファイルが horizontal layer に分かれているという理由だけで、schema、backend、
BFF、UI、infra の別チケットを作成しません。

### Implementation

ファイルを選ぶ前に responsibility boundary を検査します。`ai-authored` は通常どおり編集し、
`deterministic` は source of truth と plan/apply だけで変更し、`shared` は managed marker の
外側だけを編集します。

### Verification

実装後に SwallowKit verification を実行し、明示的な人間の判断が必要になるか収束するまで、
構造化された failure evidence に従います。

### Review

mechanical な SwallowKit verification の後に semantic/specification/engineering review を
実施します。この2つの gate は異なる問いに答えるため、相互に代替できません。

## 質問・設計の前に inspect する

タスクに関係する inspection だけを利用します。

```bash
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
npx swallowkit machine inspect boundaries
npx swallowkit machine inspect drift
npx swallowkit machine inspect infra
```

利用可能なら同等の `swallowkit_*` MCP tools を優先し、利用できない場合は Agent-facing
fallback として machine interface を使います。

これにより、generated CRUD layer の wiring、managed route の編集可否、infra operation の
有無など、current inspection で回答できる質問を人間へ転嫁しません。一方、曖昧な
product behavior、business rule、risk choice は適切に人間へ確認します。

## Responsibility boundary

`machine inspect boundaries`（または `swallowkit_inspect_boundaries`）が現在の project の
machine-readable authority です。

| zone | 編集ポリシー | 典型例 |
| --- | --- | --- |
| `ai-authored` | 直接編集する | source-of-truth model、custom logic/UI、test |
| `deterministic` | 決して手編集せず source/config と plan/apply で変更する | generated CRUD、BFF、UI、schema、infra artifacts |
| `shared` | managed marker の外側だけ編集する | SwallowKit section を含む集約・infra files |

例は inspection の代わりにはなりません。ownership は backend、feature、SwallowKit version
によって変わり得ます。

## Planning と ticketing

仕様は generated-file mechanics ではなく desired behavior を中心にします。計画には
SwallowKit constraint と plan/apply/verify loop を記録できますが、deterministic output を
独立した manual work として扱いません。

ticket boundary は、独立して実装・検証できる vertical/tracer-bullet slice とします。
horizontal ticket は、generated directory が別という理由ではなく、独立した価値やリスクが
本当に存在する場合だけにします。

## Implementation workflow

Agent の標準 workflow は次のとおりです。

```text
inspect → plan → conflict/approval の評価 → apply → verify
```

runtime が公開している場合は MCP tools を優先し、それ以外では structured machine
operations を使用します。

```bash
npx swallowkit machine inspect drift
npx swallowkit machine plan scaffold todo
npx swallowkit machine apply scaffold --plan <planId>
npx swallowkit machine verify project
```

Agent Skills 対応 runtime では `swallowkit-add-model`、`swallowkit-modify-model`、
`swallowkit-verify-repair` を利用します。それ以外では対応する
`.swallowkit/workflows/` runbook を読みます。これらは上位の implementation process から
呼び出せる task-level capability です。

## Verification と semantic review の違い

SwallowKit verification が問うこと:

> project は mechanically/structurally correct で、managed artifact drift がなく、
> configured check に成功しているか？

Semantic review が問うこと:

> design と behavior は正しいか？ specification と user intent を満たすか？

推奨順序:

```text
implementation → SwallowKit verify → semantic code review
```

verification が失敗した場合は `machine explain failure` または MCP equivalent を使い、
正しい source を修復して再度 verify します。

## Human approval

machine operation は terminal state と `nextActions` を返します。`requires-human` は意図的な
停止であり、回避すべき error ではありません。Agent は指定された判断を人間に求め、
approval を捏造してはなりません。

Azure provisioning は常に `swallowkit-provision` Skill/runbook と明示的 approval gate を
利用します。deployment 完了までという広い依頼であっても、plan 提示後に必要となる approval が
暗黙に付与されたことにはなりません。

## 外部 development process との composition

任意の process framework が discovery、specification、ticketing、TDD、implementation
orchestration、semantic review を提供し、current-project facts と deterministic operation に
SwallowKit を呼び出せます。この関係は custom Skills、Spec Kit、GSD、BMAD、通常の Codex、
Claude Code、GitHub Copilot interaction に共通です。

### 例: Matt Pocock Skills

以下は推奨 composition の例であり、互換性保証や dependency ではありません。

```text
grill-with-docs
    ├─ 必要に応じて project/entities/routes/boundaries を inspect
    ├─ repository/SwallowKit で回答可能な質問は自律的に回答
    └─ 本物の product/domain decision だけを人間に質問
    ↓
to-spec
    ├─ intent と observable behavior を記述
    ├─ SwallowKit architecture/ownership を constraint に含める
    └─ generated layer を独立した manual implementation として扱わない
    ↓
to-tickets
    ├─ vertical / tracer-bullet slice を維持
    └─ generated schema/API/BFF/UI/infra work は slice 内に含める
    ↓
implement
    ├─ boundaries を inspect
    ├─ ai-authored → 通常の implementation/TDD
    ├─ deterministic → SwallowKit plan/apply
    ├─ shared → managed marker の外側を編集
    └─ SwallowKit verify
    ↓
code-review
    └─ mechanical verification 後に semantic/spec/engineering review
```

**SwallowKit は hard dependency ではなく composition によって Matt Pocock Skills を
サポートします。** SwallowKit はこれらの Skills を install、vendor、fork、rewrite しません。

## 完全な生成 Agent documents

以下は `swallowkit init` が利用する完全な英語 template であり、抜粋ではありません。
`{{projectName}}`、`{{backendLanguageLabel}}`、`{{functionsStructureLine}}`、
`{{backendRules}}`、`{{pm}}`、`{{runCmd}}` は選択した project に合わせて展開されます。
docs は canonical template を直接 import するため、generator wording と English original は
同じ source を共有します。

## 生成される AGENTS.md

### English original

<<< ../../src/core/project/agent-templates/AGENTS.md{md}

### 日本語対訳

<<< ./generated-agent-docs/AGENTS.ja.md{md}

## 生成される CLAUDE.md

### English original

<<< ../../src/core/project/agent-templates/CLAUDE.md{md}

### 日本語対訳

<<< ./generated-agent-docs/CLAUDE.ja.md{md}

## 生成される .github/copilot-instructions.md

### English original

<<< ../../src/core/project/agent-templates/copilot-instructions.md{md}

### 日本語対訳

<<< ./generated-agent-docs/copilot-instructions.ja.md{md}
