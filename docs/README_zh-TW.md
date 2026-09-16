<div align="center">

# Spirit

一款開源 AI 智能體，旨在成倍提升你的生產力。

[Desktop 應用](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [開發](#開發)

> 本專案仍在積極開發中。各版本之間的行為與 API 可能發生變化。

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## 概覽

Spirit 是一款**工具型程式設計智能體**，以真實專案根目錄為執行上下文。同一套執行時同時驅動原生桌面工作區與終端介面。共享邏輯位於 TypeScript 套件中；各宿主在此基礎上疊加平台相關的執行、探索與 UI。

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

[`packages/agent-core`](../packages/agent-core) 是本儲存庫中 **智能體語義的唯一來源**，由各宿主消費。

### 執行時與模式

- **回合狀態機（Turn machine）** — 串流助手輸出、工具輪次、上下文壓縮，以及上下文用量追蹤。
- **Agent / Plan / Ask / Debug 模式** — 完整工具存取、僅規劃工作流、在契約層剝離編輯工具的唯讀問答，或基於日誌埋點假設的結構化除錯。
- **子智能體（Subagents）** — `subagent` 將聚焦任務委派給子執行，子執行擁有獨立工具面。
- **迴圈控制** — 啟用多任務式迴圈時，可選 `finish_task`。
- **可回退的歷史** — 訊息封存格式便於宿主側回滾並重新提交。

### 模型傳輸層

Agent Core 在統一執行時背後路由多種推理傳輸層：

| 傳輸層                | 典型提供商                                                        |
| --------------------- | ----------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI、DeepSeek、Moonshot、MiniMax、Volcengine、自訂端點         |
| **Open Responses**    | OpenAI、SpaceXAI、Vercel AI Gateway、OpenRouter、阿里巴巴（百煉） |
| **Anthropic**         | 透過 Messages API 的 Claude                                       |

提供商原生能力（例如 Open Responses 上的網頁搜尋、阿里巴巴內建搜尋與程式碼解釋器）透過請求中的 `tools` 欄位注入。

### 宿主工具契約

內建工具在 Agent Core 中統一定義（名稱、描述、JSON Schema），由宿主負責執行：

- **工作區** — `read_file`、`write_file` / `create_file` / `edit_file` / `delete_file`、`apply_patch`（在支援的傳輸層上使用 V4A）、`glob`、`grep`、`ls`
- **Shell** — `shell`，由宿主控制審批
- **Web** — `web_fetch`；搜尋透過提供商工具或已設定的宿主搜尋實現
- **委派** — `subagent`
- **規劃** — `create_plan`，工作階段 TODO 工具（`todo_list`、`todo_write`）
- **多模態** — `generate_image`、`generate_video`
- **Dreams** — `dream_list`、`dream_read`、`dream_record`、`dream_update`、`dream_delete`，用於工作區記憶摘要
- **LSP** — 編輯後展示語言伺服器診斷資訊

### 系統上下文組裝

Agent Core 決定模型如何「看見」專案上下文：

- **Rules** — `AGENTS.md`、`.spirit/rule.md` 與使用者規則槽位合併進 system 段落。
- **Skills** — 目錄與啟用 Skill 注入；宿主在磁碟上探索檔案。
- **MCP** — Model Context Protocol 用戶端、註冊表，以及 tool/resource/prompt 橋接。
- **模式提示詞** — Agent、Plan、Ask、Debug 邊界約束，不在 system 文字中重複列舉工具。

### 品質與評估

- **Smoke 套件** — 位於 `packages/agent-core/src/smoke` 的契約、執行時與線上提供商檢查。
- **Eval 框架** — 針對提示詞或工具定義變更的情境對比與評判（在儲存庫根目錄執行 `pnpm run eval:compare`）。

`@spiritagent/agent-core` 發布至 npm；[`packages/host-internal`](../packages/host-internal) 承載 Desktop 共用的宿主側探索、擴充、市集、工作區輔助與 LSP 編排。

## Desktop

[Desktop 應用](../apps/desktop) 是主要的圖形宿主：綁定工作區的 IDE 介面，內嵌對話式智能體。

- **停靠面板** — 含 Monaco 編輯器的檔案瀏覽器、嵌入式終端（Electron）、Git 變更與歷史、用於本機開發伺服器的應用內瀏覽器。
- **工作階段** — 多對話歷史、按工作階段隔離的 worktree 工作流、工具審批、子智能體檢視器、結構化問卷、上下文用量與回退（rewind）。
- **設定** — 模型提供商與 API 金鑰、Skills 與 Rules、MCP 伺服器、擴充市集、Dreams（beta）、LSP、主題，以及 UI 語言（英文 / 簡體中文 / 繁體中文等）。
- **平台** — Windows、macOS、Linux 上的 Electron；可選帶遠端配對的 Web 宿主。

Desktop 專屬開發與目錄說明見 [apps/desktop/README.md](../apps/desktop/README.md)。

## Site

[行銷站與文件站](../apps/site) 是 Next.js + Fumadocs 應用（`@spiritagent/site`），部署於 Vercel。

```bash
pnpm run dev:site
```

本機開發與 Vercel 換倉步驟見 [apps/site/README.md](../apps/site/README.md)。

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

[Rust CLI](../apps/cli)（`spirit`）提供終端優先的宿主，可選 Ratatui 介面。透過 WebSocket 連接共享 Spirit Server daemon，適合腳本化、SSH 工作階段與極簡環境。

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server)（`@spiritagent/server`，bin `spirit-server` / `spirit serve`）是第一方宿主的**共享 daemon 後端**。CLI 與 Desktop 不再在處理程序內嵌入執行階段，而是透過 WebSocket（JSON-RPC 2.0）連線同一個 daemon——在終端機發起的會話可以即時串流同步到 Desktop，反之亦然。

- **單一真相來源**——會話、串流事件、工具執行與核准佇列都執行在 daemon 內；用戶端只負責渲染與輸入。
- **隨機連接埠實例**——繫結 `127.0.0.1` 的 OS 分配連接埠，並註冊到 `{spiritDataDir}/server/instances/`；用戶端優先附加已有實例，否則啟動新實例。`spirit-server ps` / `kill` 管理實例。
- **Bearer 驗證**——home 級 token 位於 `{spiritDataDir}/server.token`（0600 權限），支援 `Authorization` 標頭或 `?token=` 查詢參數；`spirit-server rotate-token` 輪換後對新連線生效。
- **零新增依賴**——WebSocket 層（RFC 6455）在套件內實作。

**CLI 與 Desktop 的智能體執行均為 daemon-only**（見 [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)）。Desktop Web Host 用戶端由 Desktop 宿主推送已鑑權的快照，智能體執行仍在 daemon 內。遠端存取（`--hostname 0.0.0.0`）預留給後續階段，預設關閉。

## ACP Server

[`packages/acp-server`](../packages/acp-server) 是一個薄適配層，透過 stdio / ndJSON 將 Spirit 以 [Agent Client Protocol](https://agentclientprotocol.com)（ACP）伺服器的形式對外暴露。任何相容 ACP 的編輯器 — 如 **Zed** 或 **JetBrains Junie** — 都可以直接接入 Spirit 作為其 AI 編碼引擎，無需客製整合。

- **Terminal Auth** — `initialize` 宣告 `type: "terminal"` 認證方式；用戶端可 spawn `spirit-acp --setup` 進行互動式 provider 設定，隨後 `authenticate`，再 `session/new`。
- **協議表面** — `initialize`、`authenticate`、`logout`、`session/new`、`session/prompt`、`session/cancel`、`session/close`、`session/set_mode`。
- **串流與思考** — 即時 `agent_message_chunk` 串流輸出，以及 `agent_thought_chunk` 用於模型推理過程展示。
- **權限橋接** — 透過 ACP `request_permission` 進行工具審批，支援 allow-once / always-allow / reject 選項。
- **Slash 命令** — 工作區與使用者級 Skills 透過 `available_commands_update` 註冊為命令；輸入 `/skill-name` 即可啟用 Skill 並將其指令注入系統提示詞。
- **本機執行** — 工具透過 `NodeHostToolService` 在行程內執行（stdio 保留給 ACP ndJSON，不使用 JSON-RPC peer）。

### 快速開始（Zed）

1. 建置 server：`pnpm run build:acp-server`
2. 在 Zed 的 `settings.json` 中新增（`env` 中無需 API Key）：

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. 用戶端提示認證時選擇 **Run in terminal**，會 spawn `--setup`：選擇 provider、填寫憑證、選定模型。
4. Setup 寫入 Spirit 共享資料目錄（`config.json` + 系統 keyring，與 Desktop/CLI 共用）。完成後用戶端呼叫 `authenticate`，再 `session/new`。

也可在編輯器外手動 setup：

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| 環境變數               | 必填 | 說明                                                            |
| ---------------------- | ---- | --------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | 否   | 工作區根路徑（預設：用戶端 `cwd`）                              |
| `SPIRIT_ACP_DATA_DIR`  | 否   | Spirit 資料目錄（預設：`%APPDATA%/Spirit` 或 `~/.spirit-data`） |

## 開發

**環境需求：** Node.js 24+、pnpm 12+（透過 `corepack enable` 啟用）。建置 CLI 需要 Rust 工具鏈。

| 命令                       | 說明                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm install`             | 安裝 workspace 依賴（在儲存庫根目錄執行一次）                           |
| `pnpm run dev:desktop`     | 建置共享套件並啟動 Desktop（Vite + Electron）                           |
| `pnpm run dev:desktop:web` | Desktop 渲染器 + 瀏覽器 Web 宿主                                        |
| `pnpm run dev:site`        | 啟動行銷/文件站（Next.js）                                              |
| `pnpm run dev:cli`         | 含 TUI 的 CLI                                                           |
| `pnpm run build`           | 生產建置 agent-core、host-internal、server、acp-server、Desktop 與 site |
| `pnpm run eval:compare`    | 在 agent-core 變更後執行 eval 對比                                      |

### 儲存庫結構

```
apps/
  desktop/           Electron + React 宿主
  site/              行銷與文件站（Next.js，Vercel）
  cli/               Rust CLI 與 TUI
packages/
  agent-core/        智能體執行時、提示詞、工具定義、傳輸層、MCP、eval
  host-internal/     共享宿主探索、工具、擴充、LSP 輔助
  server/            共享 daemon 後端（WebSocket + JSON-RPC），面向 CLI / Desktop / Web
  acp-server/        ACP (Agent Client Protocol) 伺服器適配器，用於編輯器整合
scripts/             發布、eval 與儲存庫自動化
```

## 參與貢獻

請參閱 [CONTRIBUTING.md](../CONTRIBUTING.md) 開始參與。關於架構邊界、提交約定與 agent-core 指南，另請閱讀 [AGENTS.md](../AGENTS.md)。回報安全問題請參閱 [SECURITY.md](../SECURITY.md)。

## 授權條款

[MIT](../LICENSE)
