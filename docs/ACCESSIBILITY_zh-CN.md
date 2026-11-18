# Spirit 无障碍说明

最后更新：2026-11-18

[English](../ACCESSIBILITY.md) · [繁體中文](ACCESSIBILITY_zh-TW.md) · [日本語](ACCESSIBILITY_ja.md) · [한국어](ACCESSIBILITY_ko.md) · [Deutsch](ACCESSIBILITY_de.md) · [Français](ACCESSIBILITY_fr.md) · [Español](ACCESSIBILITY_es.md) · [Português do Brasil](ACCESSIBILITY_pt-BR.md) · [Русский](ACCESSIBILITY_ru.md)

Spirit 仍在积极开发中。本文记录当前的无障碍工作、已支持的工作流和验证覆盖范围。

## 优先事项与当前工作

Spirit 当前的无障碍工作优先关注共享 React Workbench 中的键盘操作、可见焦点、有意义的控件语义和减少动态效果；Desktop 与可选 Web 宿主共用此界面。

[PR #437：fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) 在已覆盖的视图中实现并测试了以下行为：

- 共享的[漫游焦点基础组件](../packages/ui/src/roving-focus-group.tsx)，用于线性列表、可视化网格、虚拟列表及当前行的操作。
- 在模型与提供商列表、扩展来源页签与目录、自动化列表与历史记录、工作区文件树、Git 列表、工具页签和会话侧栏中支持方向键导航，并在已实现的位置支持 Home 和 End。
- 已覆盖的复合列表仅保留一个主要 Tab 入口，同时仍可切换到当前行的操作。
- 共享 Tooltip 实现可随键盘焦点显示项目详情，在失焦或按 Escape 时关闭，并通过 `aria-describedby` 关联描述。
- 焦点指示样式与指针悬停样式相互独立，包括侧栏行和行内操作。

Workbench 还提供“减少动态效果”偏好设置，可选择“系统”“开”或“关”。[实现代码](../packages/web/src/lib/reduce-motion.ts) 在“系统”模式下遵循操作系统的 `prefers-reduced-motion` 设置，并提供供动态样式和行为共用的文档状态。

React UI 的部分组件使用原生控件、ARIA 角色、无障碍名称、`aria-current`、`aria-expanded`、`aria-selected` 等状态属性，以及状态或警告角色。共享图标辅助函数会在未提供无障碍属性或子内容时，默认向辅助技术隐藏装饰性图标。这些实现细节为辅助技术提供了语义入口，当前验证重点是键盘与焦点行为。

## 贡献者要求

修改交互式 UI 的人类贡献者和编程智能体应当：

- 保留键盘操作、可见焦点以及有意义的名称、角色和状态。在适用时复用现有共享控件和漫游焦点基础组件。
- 除非既定控件模式明确要求联动，否则应将焦点移动与激活操作分开。过去偏向指针使用的操作也应保留键盘访问路径。
- 为行为变更添加或更新针对性的回归测试。现有示例包括[漫游焦点测试](../packages/web/test/components/roving-focus-group.test.tsx)、[复合列表测试](../packages/web/test/components/keyboard-lists.test.tsx)、[侧栏键盘测试](../packages/web/test/components/session-sidebar-keyboard.test.tsx)和[工作区键盘测试](../packages/web/test/components/workspace-keyboard.test.tsx)。
- 运行相关检查，并说明验证覆盖范围。Workbench 变更可使用以下包级命令：

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

[Verify 工作流](../.github/workflows/verify.yml) 会运行 TypeScript 构建、测试、类型检查、oxlint 和 oxfmt，以及 Rust 检查。仓库通用要求见[贡献指南](../CONTRIBUTING.md#testing-and-ci)。

Vitest 和 jsdom 用于提供回归证据，辅助技术测试则单独记录。拉取请求应说明相关手动检查与验证缺口。

## 报告无障碍问题

[通过 Spirit 的 Bug 报告表单提交无障碍问题报告](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md)。请在 Issue 标题中包含“Accessibility”，便于识别。

请描述受影响的任务或页面、预期行为和实际行为。有用的背景信息包括 Spirit 版本、操作系统、输入方式、使用 Web 宿主时的浏览器，以及涉及的辅助技术。只提供你愿意分享的信息。

你可以只提交文字描述；残障背景、截图、录屏和日志均由你自行决定是否提供。如这些材料有助于定位且你愿意分享，可一并提供。分享日志前请删除 API 密钥、令牌和私密路径。

## 响应与跟踪

无障碍报告使用与其他 Spirit Bug 相同的 GitHub Issue 和拉取请求工作流。维护者会在分类处理时评估并确定优先级，状态和实现讨论记录在 Issue 及关联的拉取请求中。

## 环境覆盖

- **Desktop：** Spirit 的 Electron 外壳面向 Windows、macOS 和 Linux。
- **Web 宿主：** Desktop 与可选 Web 宿主共享 React Workbench 渲染器及键盘焦点回归测试套件。
- **键盘输入：** 自动化测试覆盖共享 React Workbench 中上述特定的导航和焦点行为。
- **屏幕阅读器和其他辅助技术：** 源代码包含语义化控件、无障碍名称、状态属性和实时状态元素。具体辅助技术的详细结果会在验证后补充。
- **CLI 与终端 UI：** Spirit 包含 Rust CLI 和可选终端 UI，这些宿主的无障碍评估仍是开放工作。

## 当前覆盖缺口

- PR #437 的键盘工作覆盖特定 React 视图和共享基础组件。Monaco 编辑器内容、嵌入式终端、应用内浏览器、扩展提供的 UI，以及其他嵌入式或第三方内容仍需单独评估。
- 流式消息、动态更新、对话框和复杂内容仍待端到端屏幕阅读器评估。现有测试聚焦 DOM 角色和键盘交互。

## 责任与维护

Spirit 维护者通过项目常规的拉取请求流程审查本文的变更。

贡献者更改受支持行为、测试覆盖范围或已知障碍时，应在同一拉取请求中提议更新本文。翻译应保留英文版对行为实现及其验证状态的区分。

## 反馈与改进

如需对本文或 Spirit 的无障碍实践提出改进建议，请[提交功能请求](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md)，或发起专注的文档拉取请求。使用 Spirit 时遇到实际障碍，请通过上方的[无障碍问题报告路径](#报告无障碍问题)反馈。
