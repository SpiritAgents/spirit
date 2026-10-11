# 為 Spirit 貢獻

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

感謝你對 Spirit 的關注！本專案是一個開源的工具型程式設計智能體 monorepo，包含 Desktop（Electron）、CLI（Rust）、共享 daemon（`packages/server`）以及核心執行時（`packages/agent-core`）。無論是修訂文件、修復缺陷，還是開發新功能，我們都歡迎你的幫助。如果不確定從哪裡開始，可以開一個 Issue，打個招呼。

## 貢獻之前

**較大的變更請先開 Issue**，以便在你投入大量精力之前，我們能先對齊方向。例如：

- 新功能或較大的使用者體驗變更
- 公開 API、協定，或設定 / 持久化格式的變更
- 跨越多個套件的重構
- 會改變智能體行為的提示詞、工具契約或上下文注入變更

**較小的變更可以直接提交 Pull Request**，例如：

- 文件、README 或註解更新
- 拼寫與樣式修復
- 行為影響清楚、範圍有限的針對性缺陷修復

若不確定，先開一個簡短的 Issue，通常比一份需要返工的大型 PR 更快。

## 借助智能體編碼

歡迎使用 Cursor、Copilot 或其他智能體工具編寫程式碼——但**你仍然要對所提交的 diff 負責**：

- 要能說明一項變更為何而做，而不只是模型生成了它
- 審閱智能體的輸出：去掉無關編輯、重複邏輯和不必要的防禦層
- 對**模型可見文案**（系統提示詞、工具名稱/描述、評測文字）格外謹慎——保持簡潔、使用英文，並避免重複請求 `tools` 欄位中已經宣告的能力
- 在 PR 描述中說明動機、影響，以及你如何驗證了這項變更

智能體可以加快實現；它們不能替代你的判斷。

## 架構與範圍

Spirit 有清晰的分層模型。在改動多個套件之前，請先閱讀 [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md)：

| 層級          | 路徑                                                                              | 職責                                  |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| 智能體語義    | `packages/agent-core`                                                             | 執行時、提示詞、工具契約、MCP、傳輸層 |
| 共享宿主邏輯  | `packages/host-internal`                                                          | 探索、擴充、工作區輔助、LSP 編排      |
| 宿主 / 適配器 | `apps/desktop`、`apps/cli`、`apps/site`、`packages/server`、`packages/acp-server` | 薄的、平台相關的 UI 與執行            |

不要在 CLI 與 Desktop 之間重複工具定義或提示詞。新的工具契約屬於 `agent-core`；執行屬於宿主。

## 開發環境

**環境需求：** Node.js 24+、pnpm 12+（`corepack enable`），以及 Rust 工具鏈（用於 CLI）。

```bash
pnpm install          # 一次，在儲存庫根目錄
pnpm run dev:desktop  # Desktop（Vite + Electron）
pnpm run dev:site     # 行銷/文件站（Next.js）
pnpm run dev:cli      # 含 TUI 的 CLI
pnpm run build        # TS 套件 + Desktop + site + CLI 的生產建置
```

在 `pnpm run dev:desktop` 期間，套件原始碼的變更無需手動重新建置：渲染器所消費的套件直接由其 TypeScript 原始碼提供（HMR）；Electron 主行程的變更會經由 watch 任務重新建置，並自動重新啟動應用。

| 命令                        | 說明                             |
| --------------------------- | -------------------------------- |
| `pnpm run dev:desktop:web`  | Desktop 渲染器 + 瀏覽器 Web 宿主 |
| `pnpm run dev:site`         | 行銷/文件站（Next.js）           |
| `pnpm run build:agent-core` | 僅建置 `@spiritagent/agent-core` |
| `pnpm run build:cli`        | Rust CLI 的發行建置              |
| `pnpm run eval:compare`     | agent-core 變更後的 eval 對比    |

詳見 [README.md — 開發](README_zh-TW.md#開發)，以及各應用或套件 README 中的具體說明。

## Git 鉤子

在儲存庫根目錄執行 `pnpm install` 會執行 `prepare`，將本機 `core.hooksPath` 設為 `.githooks`。這些鉤子只檢查 index，從不改寫檔案：

- **pre-commit：** 對 `packages` / `apps/desktop` / `apps/site` 下已暫存的 TypeScript 執行 `oxlint --deny-warnings`；當暫存檔案包含 TypeScript 或文件時執行 `oxfmt --check`（其他一併暫存的可格式化路徑也會帶上）；對已暫存的 `apps/cli` `.rs` 檔案執行 `cargo fmt --check`；對已暫存的 blob 檢查不可見 Unicode（`scripts/check-invisible-unicode.py --staged`）
- **commit-msg：** 若首行已經形如 `type:` / `type(scope):`，則要求 `:` 之後有空格，且多 scope 清單中每個逗號之後有空格。Merge、revert、中文以及其他自由形式的 subject 不會被拒絕

`git commit --no-verify` 會跳過這些鉤子；僅將其作為應急手段。從未執行 `pnpm install` 的純 Rust clone，可以用 `git config core.hooksPath .githooks` 或 `node scripts/setup-git-hooks.mjs` 啟用同一路徑。

## 進行變更

1. Fork 本儲存庫，並從 `main` 建立功能分支
2. 保持提交聚焦，diff 便於審閱
3. 力求跨平台相容（Windows、macOS、Linux），必要時使用條件編譯
4. Spirit 正處於活躍的早期開發階段——變更設定或持久化格式時，優先採用直接、可演進的結構，而不是沉重的相容墊片；若屬於破壞性變更，請在 PR 中說明理由與遷移路徑

## 分支名稱

當變更範圍限定在**單一**應用或套件時，使用 `{type}/{scope}/{description}`（三段，以斜線分隔）。**不要**寫成 `{type}/{scope}-{description}`。

- `type`：Conventional Commits 類型（`feat`、`fix`、`refactor`、`style`、`chore`、`ci` 等）
- `scope`：應用或套件（`desktop`、`cli`、`site`、`agent-core` 等），與提交訊息中的 `scope` 一致
- `description`：簡短的 kebab-case 摘要

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

涉及多個應用或套件的橫切變更省略 scope 段：`{type}/{description}`。

## 提交訊息

本專案使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `type` 與可選的 `scope` 使用英文（例如 `feat(desktop)`、`fix(agent-core)`）
- **Subject 與 body 使用英文**；subject 為一行，末尾不加句號
- Body 為可選；若寫 body，選用適合該變更的格式：用 `-` 清單（每行一項）概括要點，或在需要說明理由時寫成連續的散文段落

範例：

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

維護者與智能體側的提交約定見 [AGENTS.md](../AGENTS.md)。

## 測試與 CI

每次 push 都會執行 [Verify 工作流程](../.github/workflows/verify.yml)：

- `pnpm turbo run build`（TypeScript 套件、Desktop 與 site）
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` 以及 `pnpm exec oxfmt --check packages apps/desktop apps/site`
- CLI 的 `cargo build`、`cargo fmt --check`、`cargo clippy -D warnings` 與 `cargo test`

開 PR 之前，在相關時於本機執行：

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # 提交之前
pnpm --filter @spiritagent/agent-core test   # 如果改了 agent-core
cargo test -p spirit                   # 如果改了 CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # 如果改了模型可見的 agent-core 行為
```

## Agent-core 與模型可見變更

對系統提示詞、工具定義或上下文注入的變更，可能影響所有宿主上的智能體行為。對於較大幅度的編輯：

- 執行 `pnpm run eval:compare` 並查看結果
- 預設將 LLM 可見文案保持為英文
- 遵循 [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

小的措辭修正、拼寫修正，或非模型可見的重構，通常不需要跑完整 eval。

## Pull Request

- 使用清晰的標題和描述：**改了什麼**、**為什麼**，以及**如何測試**
- 當 PR 旨在關閉某個 Issue 時，在描述末尾單獨寫一行 `Closed #N` 或 `Fixed #N`（上方留一空行）。見 [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- 保持 diff 聚焦——無關的清理放到單獨的 PR
- 及時回應審閱意見

## 延伸閱讀

- [AGENTS.md](../AGENTS.md) — 架構說明、LLM 約定，以及上下文 push/pull 策略
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## 授權

參與貢獻即表示你同意自己的貢獻將按 [MIT License](../LICENSE) 授權。
