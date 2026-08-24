# Copilot Instructions

これは **SwallowKit** project です。

root `AGENTS.md` を canonical project contract として読み、従ってください。

SwallowKit は code generation 時だけでなく、discovery、requirements clarification、
specification、planning、ticket decomposition、implementation、verification、review で
適用されます。

重要なルール:

- current SwallowKit capability を仮定せず検査する。
- 人間に質問する前に repository/SwallowKit で確認可能な質問へ回答する。
- 利用可能な場合は `swallowkit_*` MCP tools を優先する。
- それ以外では `{{runCmd}} swallowkit machine ...` を使用する。
- framework-related file を編集する前に responsibility boundary を検査する。
- deterministic SwallowKit-managed artifact を決して手編集しない。
- deterministic generation には plan/apply を使用する。
- `requires-human` state とその他の human approval gate を尊重する。
- 完了前に SwallowKit verification を実行する。

task-specific SwallowKit Agent Skills は `.github/skills/` にあります。
Agent-agnostic equivalent は `.swallowkit/workflows/` にあります。
