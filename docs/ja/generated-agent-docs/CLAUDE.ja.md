# CLAUDE.md

これは **SwallowKit** project です。

discovery、requirements clarification、specification、planning、ticket decomposition、
implementation、verification、review の前に、root `AGENTS.md` を読み、従ってください。

SwallowKit は code generation 時だけでなく、implementation より前から考慮しなければなりません。

always-on rule:

- SwallowKit-dependent な仮定を行ったり repository で回答可能な質問をしたりする前に、
  current project と SwallowKit capability を検査する。
- `swallowkit_*` MCP tools を優先する。
- MCP が利用できない場合は `{{runCmd}} swallowkit machine ...` にフォールバックする。
- framework-related file を編集する前に responsibility boundary を検査する。
- deterministic SwallowKit-managed artifact を決して手編集しない。
- deterministic generation には plan/apply を使用する。
- すべての `requires-human` state と provisioning approval gate を尊重する。
- implementation を完了とみなす前に SwallowKit verification を実行する。

task-specific SwallowKit Agent Skills は `.github/skills/` にあります。
同等の agent-agnostic runbook は `.swallowkit/workflows/` にあります。

root `AGENTS.md` が canonical project contract です。
