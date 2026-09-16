<div align="center">

# Spirit

生産性を何倍にも引き上げるオープンソース AI エージェント。

[Desktop アプリ](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [開発](#開発)

> 本プロジェクトは活発に開発中です。リリース間で動作や API が変わる場合があります。

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## 概要

Spirit は、実プロジェクトのルートをコンテキストに動作する**ツール利用型コーディングエージェント**です。同一ランタイムがネイティブ Desktop ワークスペースとターミナル UI の両方を駆動します。共有ロジックは TypeScript パッケージにあり、各ホストがプラットフォーム固有の実行・探索・ UI を追加します。

```
┌───────────────────────────────────────────────────────┐
│  Hosts                                                │
│     ┌────────────────────────┐ ┌────────────────┐     │
│     │   Desktop       CLI    │ │   ACP Server   │     │
│     │  (Electron)    (Rust)  │ │ stdio / ndJSON │     │
│     └──────┬────────────┬────┘ └────────┬───────┘     │
│            └────────────┘               │             │
│                  ▼                      │             │
│           packages/server               │             │
│    sessions, streaming, approvals       │             │
│                  │                      │             │
│                  ▼                      │             │
│        packages/host-internal           │             │
│     discovery, tools, workspace  ◀──────┘             │
│                  │                                    │
│                  ▼                                    │
│         packages/agent-core                           │
│   runtime, prompts, tool contracts                    │
└───────────────────────────────────────────────────────┘
```

## Agent Core

[`packages/agent-core`](../packages/agent-core) は本リポジトリにおける **エージェント意味論の唯一のソース** で、各ホストがこれを利用します。

### ランタイムとモード

- **Turn machine** — ストリーミング応答、ツールラウンド、コンテキスト圧縮、使用量トラッキング。
- **Agent / Plan / Ask / Debug モード** — フルツール、計画専用ワークフロー、編集ツールを契約層で除外した読み取り専用 Q&A、またはログポイント仮説を用いた構造化デバッグ。
- **Subagents** — `subagent` が独立したツール面を持つ子実行へタスクを委譲。
- **ループ制御** — マルチタスク型ループ有効時の任意 `finish_task`。
- **巻き戻し可能な履歴** — ホスト側ロールバックと再送信向けのメッセージアーカイブ形式。

### モデルトランスポート

Agent Core は単一ランタイムの背後で複数の推論トランスポートをルーティングします：

| トランスポート        | 代表的なプロバイダ                                                      |
| --------------------- | ----------------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI、DeepSeek、Moonshot、MiniMax、Volcengine、カスタムエンドポイント |
| **Open Responses**    | OpenAI、SpaceXAI、Vercel AI Gateway、OpenRouter、Alibaba（百煉）        |
| **Anthropic**         | Messages API 経由の Claude                                              |

プロバイダー固有機能（Open Responses の Web 検索、Alibaba の組み込み検索・コードインタプリタなど）はリクエストの `tools` フィールド経由で注入されます。

### ホストツール契約

組み込みツールは Agent Core で一度定義（名前・説明・JSON Schema）し、ホストが実行します：

- **Workspace** — `read_file`、`write_file` / `create_file` / `edit_file` / `delete_file`、`apply_patch`（対応トランスポートで V4A）、`glob`、`grep`、`ls`
- **Shell** — ホスト制御の承認付き `shell`
- **Web** — `web_fetch`；検索はプロバイダーツールまたは設定済みホスト検索
- **Delegation** — `subagent`
- **Planning** — `create_plan`、セッション TODO ツール（`todo_list`、`todo_write`）
- **Multimodal** — `generate_image`、`generate_video`
- **Dreams** — ワークスペース記憶要約向け `dream_list`、`dream_read`、`dream_record`、`dream_update`、`dream_delete`
- **LSP** — 編集後の言語サーバ診断

### システムコンテキスト組み立て

Agent Core がモデルから見えるプロジェクト文脈を決定します：

- **Rules** — `AGENTS.md`、`.spirit/rule.md`、ユーザールールスロットを system セクションにマージ。
- **Skills** — カタログとアクティブ Skill 注入；ホストがディスク上のファイルを探索。
- **MCP** — Model Context Protocol クライアント、レジストリ、tool/resource/prompt ブリッジ。
- **Mode prompts** — Agent / Plan / Ask / Debug の境界；system テキストでツールを再列挙しない。

### 品質と評価

- **Smoke スイート** — `packages/agent-core/src/smoke` の契約・ランタイム・ライブプロバイダチェック。
- **Eval ハーネス** — プロンプトやツール定義変更向けシナリオ比較（リポジトリルートで `pnpm run eval:compare`）。

`@spiritagent/agent-core` は npm 公開；[`packages/host-internal`](../packages/host-internal) は Desktop 共有のホスト側探索、拡張、マーケットプレイス、ワークスペースヘルパー、LSP オーケストレーション。

## Desktop

[Desktop アプリ](../apps/desktop) は主要なグラフィカルホスト：ワークスペースに紐づく IDE 面と会話型エージェント。

- **ドックパネル** — Monaco エディタ付きファイルエクスプローラ、組み込みターミナル（Electron）、Git 変更と履歴、ローカル開発サーバー向けアプリ内ブラウザ。
- **セッション** — 複数会話履歴、セッションごとの worktree ワークフロー、ツール承認、サブエージェントビューア、構造化アンケート、コンテキスト使用量、rewind。
- **設定** — モデルプロバイダと API キー、Skills と Rules、MCP サーバー、拡張マーケットプレイス、Dreams（beta）、LSP、テーマ、UI 言語（英語 / 簡体字中国語 / 日本語など）。
- **プラットフォーム** — Windows、macOS、Linux 上の Electron；リモートペアリング可能な Web ホスト。

Desktop 固有の開発・レイアウトは [apps/desktop/README.md](../apps/desktop/README.md) を参照。

## Site

[マーケティング／ドキュメントサイト](../apps/site) は Next.js + Fumadocs アプリ（`@spiritagent/site`）で、Vercel にデプロイします。

```bash
pnpm run dev:site
```

ローカル開発と Vercel のリポジトリ切り替え手順は [apps/site/README.md](../apps/site/README.md) を参照。

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

[Rust CLI](../apps/cli)（`spirit`）はターミナル優先ホストで、オプションの Ratatui UI を提供。WebSocket 経由で共有 Spirit Server デーモンに接続し、スクリプト、SSH セッション、最小環境に適します。

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server)（`@spiritagent/server`、bin `spirit-server` / `spirit serve`）は、ファーストパーティホスト向けの**共有デーモンバックエンド**です。CLI と Desktop はプロセス内にランタイムを埋め込まず、WebSocket（JSON-RPC 2.0）で同じデーモンに接続します。ターミナルで開始したセッションはリアルタイムで Desktop にストリーミングされ、その逆も同様です。

- **単一の信頼できる情報源** — セッション、ストリーミングイベント、ツール実行、承認キューはすべてデーモン内に保持され、クライアントは描画と入力だけを担当します。
- **ランダムポートインスタンス** — `127.0.0.1` の OS 割り当てポートにバインドし、`{spiritDataDir}/server/instances/` に登録されます。クライアントは既存インスタンスへのアタッチを優先し、なければ新規起動します。`spirit-server ps` / `kill` でインスタンスを管理します。
- **Bearer 認証** — ホームレベルのトークンは `{spiritDataDir}/server.token`（パーミッション 0600）に保存され、`Authorization` ヘッダーまたは `?token=` クエリで受け付けます。`spirit-server rotate-token` でローテーションすると新規接続に適用されます。
- **新規依存ゼロ** — WebSocket 層（RFC 6455）はパッケージ内に実装されています。

**CLI と Desktop のエージェント実行は daemon-only** です（[Epic #274](https://github.com/SpiritAgents/spirit/issues/274) を参照）。Desktop Web Host クライアントは Desktop ホストから認証済みスナップショットを受け取り、エージェント実行はデーモン内で行われます。リモートアクセス（`--hostname 0.0.0.0`）は将来のフェーズ向けに予約されており、デフォルトでは無効です。

## ACP Server

[`packages/acp-server`](../packages/acp-server) は薄いアダプターで、stdio / ndJSON 経由で Spirit を [Agent Client Protocol](https://agentclientprotocol.com)（ACP）サーバーとして公開します。**Zed** や **JetBrains Junie** など ACP 対応エディタが、カスタム統合なしで Spirit を AI コーディングエンジンとして接続できます。

- **Terminal Auth** — `initialize` が `type: "terminal"` 認証を告知；クライアントは `spirit-acp --setup` で対話的 provider 設定後、`authenticate` → `session/new`。
- **プロトコル面** — `initialize`、`authenticate`、`logout`、`session/new`、`session/prompt`、`session/cancel`、`session/close`、`session/set_mode`。
- **ストリーミングと思考** — リアルタイム `agent_message_chunk` と推論出力向け `agent_thought_chunk`。
- **権限ブリッジ** — ACP `request_permission` によるツール承認（allow-once / always-allow / reject）。
- **Slash コマンド** — ワークスペースとユーザー Skills を `available_commands_update` で登録；`/skill-name` で Skill 有効化と system プロンプト注入。
- **ローカル実行** — `NodeHostToolService` でプロセス内実行（stdio は ACP ndJSON 専用）。

### クイックスタート（Zed）

1. サーバーをビルド：`pnpm run build:acp-server`
2. Zed の `settings.json` に追加（`env` に API キー不要）：

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. 認証プロンプトで **Run in terminal** を選択 → `--setup` が起動し、provider・認証情報・モデルを選択。
4. Setup は Spirit 共有データディレクトリ（`config.json` + OS keyring、Desktop/CLI と共通）に書き込み。完了後クライアントが `authenticate` → `session/new`。

エディタ外での手動 setup：

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| 環境変数               | 必須   | 説明                                                                                |
| ---------------------- | ------ | ----------------------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | いいえ | ワークスペースルート（デフォルト：クライアント `cwd`）                              |
| `SPIRIT_ACP_DATA_DIR`  | いいえ | Spirit データディレクトリ（デフォルト：`%APPDATA%/Spirit` または `~/.spirit-data`） |

## 開発

**要件：** Node.js 24+、pnpm 12+（`corepack enable` で有効化）。CLI ビルドには Rust ツールチェーン。

| コマンド                   | 説明                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `pnpm install`             | workspace 依存関係をインストール（リポジトリルートで一度）                |
| `pnpm run dev:desktop`     | 共有パッケージをビルドして Desktop 起動（Vite + Electron）                |
| `pnpm run dev:desktop:web` | Desktop レンダラー + ブラウザ Web ホスト                                  |
| `pnpm run dev:site`        | マーケティング／ドキュメントサイトを起動（Next.js）                       |
| `pnpm run dev:cli`         | TUI 付き CLI                                                              |
| `pnpm run build`           | agent-core、host-internal、server、acp-server、Desktop、site の本番ビルド |
| `pnpm run eval:compare`    | agent-core 変更後の eval 比較                                             |

### リポジトリ構成

```
apps/
  desktop/           Electron + React ホスト
  site/              マーケティング／ドキュメントサイト（Next.js、Vercel）
  cli/               Rust CLI と TUI
packages/
  agent-core/        エージェントランタイム、プロンプト、ツール定義、トランスポート、MCP、eval
  host-internal/     共有ホスト探索、ツール、拡張、LSP ヘルパー
  server/            CLI / Desktop / Web 向け共有デーモンバックエンド（WebSocket + JSON-RPC）
  acp-server/        エディタ統合向け ACP サーバーアダプター
scripts/             リリース、eval、リポジトリ自動化
```

## コントリビューション

参加方法は [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。アーキテクチャ境界、コミット規約、agent-core ガイドラインについては [AGENTS.md](../AGENTS.md) もお読みください。セキュリティ問題の報告は [SECURITY.md](../SECURITY.md) を参照。

## ライセンス

[MIT](../LICENSE)
