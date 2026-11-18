# Spirit 無障礙說明

最後更新：2026-11-18

[English](../ACCESSIBILITY.md) · [简体中文](ACCESSIBILITY_zh-CN.md) · [日本語](ACCESSIBILITY_ja.md) · [한국어](ACCESSIBILITY_ko.md) · [Deutsch](ACCESSIBILITY_de.md) · [Français](ACCESSIBILITY_fr.md) · [Español](ACCESSIBILITY_es.md) · [Português do Brasil](ACCESSIBILITY_pt-BR.md) · [Русский](ACCESSIBILITY_ru.md)

Spirit 仍在積極開發中。本文記錄目前的無障礙工作、已支援的工作流程與驗證涵蓋範圍。

## 優先事項與目前工作

Spirit 目前的無障礙工作優先關注共享 React Workbench 中的鍵盤操作、可見焦點、有意義的控制項語意與減少動態效果；Desktop 與可選 Web 宿主共用此介面。

[PR #437：fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) 在已涵蓋的檢視中實作並測試了以下行為：

- 共享的[漫遊焦點基礎元件](../packages/ui/src/roving-focus-group.tsx)，用於線性清單、視覺網格、虛擬清單及目前列的操作。
- 在模型與提供者清單、擴充來源頁籤與目錄、自動化清單與歷史記錄、工作區檔案樹、Git 清單、工具頁籤和工作階段側欄中支援方向鍵導覽，並在已實作的位置支援 Home 和 End。
- 已涵蓋的複合清單僅保留一個主要 Tab 入口，同時仍可切換至目前列的操作。
- 共享 Tooltip 實作可隨鍵盤焦點顯示項目詳情，在失焦或按 Escape 時關閉，並透過 `aria-describedby` 關聯描述。
- 焦點指示樣式與指標懸停樣式相互獨立，包括側欄列與列內操作。

Workbench 也提供「減少動態效果」偏好設定，可選擇「系統」「開」或「關」。[實作程式碼](../packages/web/src/lib/reduce-motion.ts) 在「系統」模式下遵循作業系統的 `prefers-reduced-motion` 設定，並提供供動態樣式與行為共用的文件狀態。

React UI 的部分元件使用原生控制項、ARIA 角色、無障礙名稱、`aria-current`、`aria-expanded`、`aria-selected` 等狀態屬性，以及狀態或警示角色。共享圖示輔助函式會在未提供無障礙屬性或子內容時，預設向輔助技術隱藏裝飾性圖示。這些實作細節為輔助技術提供了語意入口，目前驗證重點是鍵盤與焦點行為。

## 貢獻者要求

修改互動式 UI 的人類貢獻者與程式設計代理應當：

- 保留鍵盤操作、可見焦點以及有意義的名稱、角色與狀態。在適用時重用現有共享控制項與漫遊焦點基礎元件。
- 除非既定控制項模式明確要求連動，否則應將焦點移動與啟動操作分開。過去偏向指標使用的操作也應保留鍵盤存取路徑。
- 為行為變更新增或更新針對性的回歸測試。現有範例包括[漫遊焦點測試](../packages/web/test/components/roving-focus-group.test.tsx)、[複合清單測試](../packages/web/test/components/keyboard-lists.test.tsx)、[側欄鍵盤測試](../packages/web/test/components/session-sidebar-keyboard.test.tsx)和[工作區鍵盤測試](../packages/web/test/components/workspace-keyboard.test.tsx)。
- 執行相關檢查，並說明驗證涵蓋範圍。Workbench 變更可使用以下套件命令：

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

[Verify 工作流程](../.github/workflows/verify.yml) 會執行 TypeScript 建置、測試、型別檢查、oxlint 和 oxfmt，以及 Rust 檢查。儲存庫通用要求見[貢獻指南](../CONTRIBUTING.md#testing-and-ci)。

Vitest 和 jsdom 用於提供回歸證據，輔助技術測試則單獨記錄。拉取請求應說明相關手動檢查與驗證缺口。

## 回報無障礙問題

[透過 Spirit 的 Bug 回報表單提交無障礙問題報告](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md)。請在 Issue 標題中包含「Accessibility」，便於識別。

請描述受影響的任務或頁面、預期行為與實際行為。有用的背景資訊包括 Spirit 版本、作業系統、輸入方式、使用 Web 宿主時的瀏覽器，以及涉及的輔助技術。只提供你願意分享的資訊。

你可以只提交文字描述；身心障礙背景、截圖、錄影與記錄均由你自行決定是否提供。如這些資料有助於定位且你願意分享，可一併提供。分享記錄前請移除 API 金鑰、權杖與私密路徑。

## 回應與追蹤

無障礙報告使用與其他 Spirit Bug 相同的 GitHub Issue 和拉取請求工作流程。維護者會在分類處理時評估並確定優先順序，狀態與實作討論記錄在 Issue 及關聯的拉取請求中。

## 環境涵蓋

- **Desktop：** Spirit 的 Electron 外殼面向 Windows、macOS 和 Linux。
- **Web 宿主：** Desktop 與可選 Web 宿主共享 React Workbench 轉譯器及鍵盤焦點回歸測試套件。
- **鍵盤輸入：** 自動化測試涵蓋共享 React Workbench 中上述特定的導覽與焦點行為。
- **螢幕閱讀器與其他輔助技術：** 原始碼包含語意化控制項、無障礙名稱、狀態屬性與即時狀態元素。具體輔助技術的詳細結果會在驗證後補充。
- **CLI 與終端機 UI：** Spirit 包含 Rust CLI 與可選終端機 UI，這些宿主的無障礙評估仍是開放工作。

## 目前涵蓋缺口

- PR #437 的鍵盤工作涵蓋特定 React 檢視與共享基礎元件。Monaco 編輯器內容、嵌入式終端機、應用程式內瀏覽器、擴充提供的 UI，以及其他嵌入式或第三方內容仍需單獨評估。
- 串流訊息、動態更新、對話框與複雜內容仍待端對端螢幕閱讀器評估。現有測試聚焦 DOM 角色與鍵盤互動。

## 責任與維護

Spirit 維護者透過專案常規的拉取請求流程審查本文的變更。

貢獻者更改受支援行為、測試涵蓋範圍或已知障礙時，應在同一拉取請求中提議更新本文。翻譯應保留英文版對行為實作及其驗證狀態的區分。

## 意見與改進

如需對本文或 Spirit 的無障礙實踐提出改進建議，請[提交功能請求](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md)，或提出專注的文件拉取請求。使用 Spirit 時遇到實際障礙，請透過上方的[無障礙問題回報路徑](#回報無障礙問題)回報。
