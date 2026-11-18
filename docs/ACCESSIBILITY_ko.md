# Spirit 접근성

최종 업데이트: 2026-11-18

[English](../ACCESSIBILITY.md) · [简体中文](ACCESSIBILITY_zh-CN.md) · [繁體中文](ACCESSIBILITY_zh-TW.md) · [日本語](ACCESSIBILITY_ja.md) · [Deutsch](ACCESSIBILITY_de.md) · [Français](ACCESSIBILITY_fr.md) · [Español](ACCESSIBILITY_es.md) · [Português do Brasil](ACCESSIBILITY_pt-BR.md) · [Русский](ACCESSIBILITY_ru.md)

Spirit은 활발히 개발 중입니다. 이 문서는 현재의 접근성 작업, 지원되는 워크플로와 검증 범위를 기록합니다.

## 우선순위와 현재 작업

Spirit의 현재 접근성 작업은 Desktop과 선택적 웹 호스트가 공유하는 React Workbench에서 키보드 조작, 눈에 보이는 포커스, 의미 있는 컨트롤 시맨틱, 동작 줄이기를 우선합니다.

[PR #437: fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437)는 해당 보기에서 다음 동작을 구현하고 테스트했습니다.

- 선형 목록, 시각적 그리드, 가상화 목록 및 현재 행의 작업을 위한 공유 [로빙 포커스 기본 요소](../packages/ui/src/roving-focus-group.tsx).
- 모델 및 공급자 목록, 확장 소스 탭과 카탈로그, 자동화 목록과 기록, 워크스페이스 파일 트리, Git 목록, 도구 탭, 세션 사이드바에서 방향키 탐색. 구현된 위치에서는 Home과 End도 지원합니다.
- 해당 복합 목록에는 주요 Tab 진입점을 하나만 유지하면서 현재 행의 작업도 키보드로 접근할 수 있습니다.
- 공유 Tooltip 구현에서 키보드 포커스에 따라 항목 세부 정보를 표시하고, 포커스를 잃거나 Escape를 누르면 닫으며, `aria-describedby`로 설명을 연결합니다.
- 사이드바 행과 인라인 작업을 포함하여 포인터 호버 스타일과 구분되는 포커스 표시.

Workbench에는 시스템, 켜기, 끄기 중 선택할 수 있는 동작 줄이기 기본 설정도 있습니다. [구현](../packages/web/src/lib/reduce-motion.ts)은 시스템 모드에서 운영체제의 `prefers-reduced-motion` 설정을 따르며, 동작 인식 스타일과 동작이 공유하는 문서 상태를 제공합니다.

React UI의 일부에는 네이티브 컨트롤, ARIA 역할, 접근 가능한 이름, `aria-current`, `aria-expanded`, `aria-selected` 같은 상태 속성, status 또는 alert 역할이 사용됩니다. 공유 아이콘 도우미는 접근성 속성이나 자식 콘텐츠가 제공되지 않은 장식용 아이콘을 기본적으로 보조 기술에서 숨깁니다. 이러한 구현은 보조 기술에 시맨틱 정보를 제공하며, 현재 검증은 키보드와 포커스 동작에 집중되어 있습니다.

## 기여자 요구 사항

대화형 UI를 변경하는 사람 기여자와 코딩 에이전트는 다음을 따라야 합니다.

- 키보드 조작, 눈에 보이는 포커스, 의미 있는 이름·역할·상태를 유지합니다. 적합한 경우 기존 공유 컨트롤과 로빙 포커스 기본 요소를 재사용합니다.
- 확립된 컨트롤 패턴이 명시적으로 연결하지 않는 한 포커스 이동과 활성화를 구분합니다. 기존에 포인터 중심이던 작업에도 키보드 접근 경로를 유지합니다.
- 변경된 동작에 대한 회귀 테스트를 추가하거나 업데이트합니다. 기존 예시로는 [로빙 포커스 테스트](../packages/web/test/components/roving-focus-group.test.tsx), [복합 목록 테스트](../packages/web/test/components/keyboard-lists.test.tsx), [사이드바 키보드 테스트](../packages/web/test/components/session-sidebar-keyboard.test.tsx), [워크스페이스 키보드 테스트](../packages/web/test/components/workspace-keyboard.test.tsx)가 있습니다.
- 관련 검사를 실행하고 검증 범위를 보고합니다. Workbench 변경에는 다음 패키지 명령을 사용할 수 있습니다.

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

[Verify 워크플로](../.github/workflows/verify.yml)는 TypeScript 빌드, 테스트, 타입 검사, oxlint, oxfmt와 Rust 검사를 실행합니다. 저장소의 일반 지침은 [Spirit 기여 가이드](../CONTRIBUTING.md#testing-and-ci)를 참조하세요.

Vitest와 jsdom은 회귀 증거를 수집하는 데 사용하고, 보조 기술 테스트는 별도로 기록합니다. Pull Request에는 관련 수동 검사와 검증 공백을 명시하세요.

## 접근성 장벽 신고

[Spirit 버그 신고 양식을 사용해 접근성 장벽을 신고](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md)하세요. 쉽게 알아볼 수 있도록 Issue 제목에 “Accessibility”를 포함해 주세요.

영향을 받는 작업이나 페이지, 예상한 동작, 실제 동작을 설명해 주세요. Spirit 버전, 운영체제, 입력 방식, 웹 호스트 사용 시 브라우저, 관련 보조 기술 등이 유용한 정보입니다. 공유해도 괜찮은 정보만 제공하면 됩니다.

텍스트 설명만으로도 신고할 수 있습니다. 장애 관련 배경, 스크린샷, 녹화, 로그는 선택 사항입니다. 문제 파악에 도움이 되고 공유해도 괜찮은 경우에만 첨부하세요. 로그를 공유할 때는 API 키, 토큰, 비공개 경로를 제거하세요.

## 대응 및 추적

접근성 신고는 다른 Spirit 버그와 동일한 GitHub Issue 및 Pull Request 워크플로를 사용합니다. 유지관리자는 분류 과정에서 평가하고 우선순위를 정하며, 상태와 구현 논의는 Issue와 연결된 Pull Request에 기록합니다.

## 환경별 검증 범위

- **Desktop:** Spirit의 Electron 셸은 Windows, macOS, Linux를 대상으로 합니다.
- **웹 호스트:** Desktop과 선택적 웹 호스트는 React Workbench 렌더러와 키보드 포커스 회귀 테스트 스위트를 공유합니다.
- **키보드 입력:** 자동화 테스트는 공유 React Workbench에서 위에 설명한 특정 탐색 및 포커스 동작을 다룹니다.
- **스크린 리더 및 기타 보조 기술:** 소스에는 시맨틱 컨트롤, 접근 가능한 이름, 상태 속성, 라이브 상태 요소가 포함됩니다. 개별 보조 기술에 대한 자세한 결과는 검증 후 추가할 수 있습니다.
- **CLI 및 터미널 UI:** Spirit에는 Rust CLI와 선택적 터미널 UI가 포함됩니다. 이러한 호스트의 접근성 평가는 앞으로 확장할 영역입니다.

## 현재 검증 범위의 공백

- PR #437의 키보드 작업은 특정 React 보기와 공유 기본 요소를 다룹니다. Monaco 편집기 콘텐츠, 내장 터미널, 인앱 브라우저, 확장이 제공하는 UI 및 기타 내장 또는 서드파티 콘텐츠는 별도의 평가 영역입니다.
- 스트리밍 메시지, 동적 업데이트, 대화 상자 및 복잡한 콘텐츠는 종단 간 스크린 리더 평가가 필요한 영역입니다. 기존 테스트는 DOM 역할과 키보드 상호작용에 집중합니다.

## 소유 및 유지관리

Spirit 유지관리자는 프로젝트의 일반 Pull Request 과정을 통해 이 문서의 변경을 검토합니다.

지원 동작, 테스트 범위 또는 알려진 장벽을 변경하는 기여자는 같은 Pull Request에서 이 문서의 업데이트도 제안해야 합니다. 번역은 영어 원문의 동작 구현과 검증 상태 구분을 유지해야 합니다.

## 피드백 및 개선

이 문서나 Spirit의 접근성 관행에 개선을 제안하려면 [기능 요청을 열거나](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md) 범위를 한정한 문서 Pull Request를 제출하세요. Spirit 사용 중 실제 장벽을 겪었다면 위의 [접근성 장벽 신고 경로](#접근성-장벽-신고)를 이용하세요.
