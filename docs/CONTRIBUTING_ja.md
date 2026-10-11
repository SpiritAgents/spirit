# Spirit に貢献する

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

Spirit に関心をお寄せいただきありがとうございます！本プロジェクトは、オープンソースのツール利用型コーディングエージェントのモノレポです。Desktop（Electron）、CLI（Rust）、共有デーモン（`packages/server`）、コアランタイム（`packages/agent-core`）で構成されます。ドキュメントの修正、バグの修正、新機能の開発のいずれでも、協力を歓迎します。どこから始めればよいか分からない場合は、Issue を開いて挨拶してください。

## 貢献する前に

**大きな変更は、先に Issue を開いてください。** 大きな労力を投じる前に、方向性を合わせるためです。例：

- 新機能、または大きな UX の変更
- 公開 API、プロトコル、または設定 / 永続化フォーマットの変更
- 複数パッケージにまたがるリファクタ
- エージェントの挙動を変えるプロンプト、ツール契約、コンテキスト注入の変更

**小さな変更は、そのまま Pull Request にしてかまいません。** 例：

- ドキュメント、README、コメントの更新
- スペルとスタイルの修正
- 挙動への影響が明確で限られる、対象を絞ったバグ修正

判断に迷う場合は、短い Issue の方が、手戻りのある大きな PR より通常は速いです。

## エージェントによるコーディング

Cursor、Copilot、その他のエージェントツールでコードを書くことは歓迎します。ただし、**提出する diff の責任は引き続きあなたにあります**：

- 変更の理由を説明できること。モデルが生成した、というだけでは不十分です
- エージェントの出力を確認する：無関係な編集、重複したロジック、不要な防御レイヤーを除く
- **モデル可視の文言**（システムプロンプト、ツールの名前と説明、eval のテキスト）は特に慎重に扱う。簡潔に、英語で書き、リクエストの `tools` フィールドで既に宣言されている能力を繰り返さない
- PR の説明に、動機、影響、検証方法を書く

エージェントは実装を速くできます。判断の代わりにはなりません。

## アーキテクチャと範囲

Spirit には明確なレイヤーモデルがあります。複数パッケージに手を入れる前に、[`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md) を読んでください：

| レイヤー            | パス                                                                              | 役割                                                     |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| エージェント意味論  | `packages/agent-core`                                                             | ランタイム、プロンプト、ツール契約、MCP、トランスポート  |
| 共有ホストロジック  | `packages/host-internal`                                                          | 探索、拡張、ワークスペース補助、LSP オーケストレーション |
| ホスト / アダプター | `apps/desktop`、`apps/cli`、`apps/site`、`packages/server`、`packages/acp-server` | 薄い、プラットフォーム固有の UI と実行                   |

ツール定義やプロンプトを CLI と Desktop の間で重複させないでください。新しいツール契約は `agent-core` に置き、実行はホストに置きます。

## 開発環境

**要件：** Node.js 24+、pnpm 12+（`corepack enable`）、および Rust ツールチェーン（CLI 用）。

```bash
pnpm install          # 一度、リポジトリルートで
pnpm run dev:desktop  # Desktop（Vite + Electron）
pnpm run dev:site     # マーケティング／ドキュメントサイト（Next.js）
pnpm run dev:cli      # TUI 付き CLI
pnpm run build        # TS パッケージ + Desktop + site + CLI の本番ビルド
```

`pnpm run dev:desktop` の実行中、パッケージのソース変更に手動リビルドは不要です。レンダラーが消費するパッケージは TypeScript ソースから配信され（HMR）、Electron メインプロセスの変更は watch タスクで再ビルドされ、アプリは自動的に再起動します。

| コマンド                    | 説明                                          |
| --------------------------- | --------------------------------------------- |
| `pnpm run dev:desktop:web`  | Desktop レンダラー + ブラウザ Web ホスト      |
| `pnpm run dev:site`         | マーケティング／ドキュメントサイト（Next.js） |
| `pnpm run build:agent-core` | `@spiritagent/agent-core` のみをビルド        |
| `pnpm run build:cli`        | Rust CLI のリリースビルド                     |
| `pnpm run eval:compare`     | agent-core 変更後の eval 比較                 |

詳細は [README.md — 開発](README_ja.md#開発) と、各アプリ / パッケージの README を参照してください。

## Git フック

リポジトリルートの `pnpm install` は `prepare` を実行し、ローカルの `core.hooksPath` を `.githooks` に設定します。フックは index のみを検査し、ファイルを書き換えません：

- **pre-commit：** `packages` / `apps/desktop` / `apps/site` 配下のステージされた TypeScript に `oxlint --deny-warnings`。ステージされたファイルに TypeScript またはドキュメントが含まれる場合は `oxfmt --check`（一緒にステージされた、他のフォーマット対象パスも対象に含まれる）。ステージされた `apps/cli` の `.rs` ファイルに `cargo fmt --check`。ステージされた blob の不可視 Unicode を検査（`scripts/check-invisible-unicode.py --staged`）
- **commit-msg：** 先頭行が既に `type:` / `type(scope):` の形なら、`:` の後、および複数 scope のリストでは各カンマの後に空白を要求します。Merge、revert、中国語、その他の自由形式の subject は拒否しません

`git commit --no-verify` はフックをスキップします。緊急時の回避手段としてだけ使ってください。`pnpm install` を一度も実行しない Rust のみの clone は、`git config core.hooksPath .githooks` または `node scripts/setup-git-hooks.mjs` で同じパスを有効にできます。

## 変更を加える

1. リポジトリを Fork し、`main` から feature ブランチを作成する
2. コミットを絞り、diff をレビューしやすく保つ
3. クロスプラットフォーム互換（Windows、macOS、Linux）を目指し、必要な箇所では条件コンパイルを含める
4. Spirit は活発な初期開発段階にある。設定や永続化フォーマットを変えるときは、重い互換シムより、直接的で進化させやすい構造を優先する。破壊的変更の場合は、理由と移行経路を PR に書く

## ブランチ名

変更が**単一**のアプリまたはパッケージに限られる場合は、`{type}/{scope}/{description}`（スラッシュ区切りの 3 セグメント）を使います。`{type}/{scope}-{description}` とは**書かない**でください。

- `type`：Conventional Commits の type（`feat`、`fix`、`refactor`、`style`、`chore`、`ci` など）
- `scope`：アプリまたはパッケージ（`desktop`、`cli`、`site`、`agent-core` など）。コミットの `scope` と一致させる
- `description`：短い kebab-case の要約

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

複数のアプリまたはパッケージにまたがる横断的な変更では、scope セグメントを省きます：`{type}/{description}`。

## コミットメッセージ

本プロジェクトは [Conventional Commits](https://www.conventionalcommits.org/) を使います：

- `type` と任意の `scope` は英語（例：`feat(desktop)`、`fix(agent-core)`）
- **subject と body は英語**。subject は 1 行で、末尾にピリオドを付けない
- body は任意。書く場合は、変更に合う形式を選ぶ。要約の要点には 1 行 1 項目の `-` リスト、理由の説明が必要なら連続した散文の段落

例：

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

メンテナー側とエージェント側のコミット規約は [AGENTS.md](../AGENTS.md) にあります。

## テストと CI

push のたびに [Verify ワークフロー](../.github/workflows/verify.yml) が実行されます：

- `pnpm turbo run build`（TypeScript パッケージ、Desktop、site）
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` と `pnpm exec oxfmt --check packages apps/desktop apps/site`
- CLI の `cargo build`、`cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`

PR を開く前に、関係するコマンドをローカルで実行してください：

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # コミット前
pnpm --filter @spiritagent/agent-core test   # agent-core を変更した場合
cargo test -p spirit                   # CLI を変更した場合
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # モデル可視の agent-core の挙動を変更した場合
```

## Agent-core とモデル可視の変更

システムプロンプト、ツール定義、コンテキスト注入の変更は、すべてのホストでエージェントの挙動に影響することがあります。大きな編集では：

- `pnpm run eval:compare` を実行し、結果を確認する
- LLM 可視の文言は、デフォルトで英語のままにする
- [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md) に従う

文言の小さな修正、スペル修正、モデルから見えないリファクタには、通常、完全な eval の実行は不要です。

## Pull Request

- 明確なタイトルと説明を書く：**何を**変えたか、**なぜ**か、**どう検証した**か
- PR が Issue を閉じるためのものである場合、説明の末尾を独立した最終行 `Closed #N` または `Fixed #N` にする（その上に空行）。[AGENTS.md](../AGENTS.md#pull-requests-that-close-issues) を参照
- diff を絞る。無関係な整理は別の PR にする
- レビューへの指摘には速やかに応じる

## 関連資料

- [AGENTS.md](../AGENTS.md) — アーキテクチャの注記、LLM の規約、コンテキストの push/pull 戦略
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## ライセンス

貢献により、あなたの貢献が [MIT License](../LICENSE) の下でライセンスされることに同意したものとみなされます。
