# CLAUDE.md

これは SwallowKit プロジェクトです。調査、要件整理、仕様作成、計画、チケット分割、実装、検証、レビューの前に、ルートの `AGENTS.md` を読んで従ってください。
コード生成を始める前から、SwallowKit の構成と編集規則を考慮します。

常に適用する規則は次のとおりです。

- 機能を推測したり人に質問したりする前に、現在のプロジェクトと利用できる機能を検査します。リポジトリで分かることはエージェントが確認してください。
- 利用できる場合は `swallowkit_*` MCP ツールを優先し、使えない場合は `{{runCmd}} swallowkit machine ...` を使用します。
- 構成に関わるファイルを編集する前に、責任範囲と編集規則を検査します。SwallowKit 管理の生成物を手編集してはいけません。
- 認証スキームは plan/apply auth で追加します。`swallowkit.config` の `auth.schemes` を手書きしてはいけません。`auth.authorization.policies` と `swa.allowedProviders` は apply 後に追記します。
- 生成物の変更には plan/apply を使い、`requires-human` とリソース作成・更新時の承認手順に従います。
- 完了前に SwallowKit の検証を実行します。機械的な検証だけでは E2E の動作を確認したことにはなりません。
- 永続化、開発用シード、実動作の証拠、ローカルサービスとデータの保護は、ルートの `AGENTS.md` に従います。

作業ごとの Agent Skills は `.github/skills/`、同じ作業の手順書は `.swallowkit/workflows/` にあります。
共通のプロジェクト規約は、ルートの `AGENTS.md` です。
