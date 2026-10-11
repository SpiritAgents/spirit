# Spirit에 기여하기

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

Spirit에 관심을 가져 주셔서 감사합니다! 이 프로젝트는 오픈 소스 도구 기반 코딩 에이전트 모노레포입니다. Desktop(Electron), CLI(Rust), 공유 데몬(`packages/server`), 핵심 런타임(`packages/agent-core`)으로 이루어져 있습니다. 문서를 고치든, 버그를 수정하든, 새 기능을 만들든 도움을 환영합니다. 어디서 시작할지 모르겠다면 Issue를 열고 인사해 주세요.

## 기여하기 전에

**큰 변경은 먼저 Issue를 여세요.** 상당한 노력을 들이기 전에 방향을 맞추기 위해서입니다. 예:

- 새 기능 또는 큰 UX 변경
- 공개 API, 프로토콜, 또는 구성 / 영속화 형식 변경
- 여러 패키지에 걸친 리팩터
- 에이전트 동작을 바꾸는 프롬프트, 도구 계약, 컨텍스트 주입 변경

**작은 변경은 바로 Pull Request로 가도 됩니다.** 예:

- 문서, README, 주석 업데이트
- 철자와 스타일 수정
- 동작 영향이 분명하고 제한적인, 범위가 좁은 버그 수정

확신이 없으면, 짧은 Issue가 다시 손봐야 하는 큰 PR보다 보통 더 빠릅니다.

## 에이전트 코딩

Cursor, Copilot 또는 다른 에이전트 도구로 코드를 작성하는 것은 환영합니다. 다만 **제출하는 diff에 대한 책임은 여전히 본인에게 있습니다**:

- 변경을 한 이유를 설명할 수 있어야 합니다. 모델이 만들었다는 것만으로는 충분하지 않습니다
- 에이전트 출력을 검토합니다. 관련 없는 편집, 중복된 로직, 불필요한 방어 계층을 제거합니다
- **모델에 보이는 문구**(시스템 프롬프트, 도구 이름/설명, eval 텍스트)는 더 신중히 다룹니다. 간결하게, 영어로 쓰고, 요청의 `tools` 필드에 이미 선언된 능력을 반복하지 않습니다
- PR 설명에 동기, 영향, 검증 방법을 적습니다

에이전트는 구현을 빠르게 할 수 있습니다. 판단을 대신할 수는 없습니다.

## 아키텍처와 범위

Spirit에는 명확한 계층 모델이 있습니다. 여러 패키지를 건드리기 전에 [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md)를 읽으세요:

| 계층             | 경로                                                                              | 역할                                              |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| 에이전트 의미론  | `packages/agent-core`                                                             | 런타임, 프롬프트, 도구 계약, MCP, 트랜스포트      |
| 공유 호스트 로직 | `packages/host-internal`                                                          | 탐색, 확장, 워크스페이스 보조, LSP 오케스트레이션 |
| 호스트 / 어댑터  | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | 얇은, 플랫폼별 UI와 실행                          |

도구 정의나 프롬프트를 CLI와 Desktop에 중복해서 두지 마세요. 새 도구 계약은 `agent-core`에 두고, 실행은 호스트에 둡니다.

## 개발 환경

**요구 사항:** Node.js 24+, pnpm 12+(`corepack enable`), 그리고 Rust 툴체인(CLI용).

```bash
pnpm install          # 한 번, 저장소 루트에서
pnpm run dev:desktop  # Desktop(Vite + Electron)
pnpm run dev:site     # 마케팅/문서 사이트(Next.js)
pnpm run dev:cli      # TUI가 있는 CLI
pnpm run build        # TS 패키지 + Desktop + site + CLI의 프로덕션 빌드
```

`pnpm run dev:desktop` 동안 패키지 소스 변경은 수동 재빌드가 필요 없습니다. 렌더러가 소비하는 패키지는 TypeScript 소스에서 제공되고(HMR), Electron 메인 프로세스 변경은 watch 작업으로 다시 빌드된 뒤 앱이 자동으로 재시작됩니다.

| 명령                        | 설명                                 |
| --------------------------- | ------------------------------------ |
| `pnpm run dev:desktop:web`  | Desktop 렌더러 + 브라우저 Web 호스트 |
| `pnpm run dev:site`         | 마케팅/문서 사이트(Next.js)          |
| `pnpm run build:agent-core` | `@spiritagent/agent-core`만 빌드     |
| `pnpm run build:cli`        | Rust CLI의 릴리스 빌드               |
| `pnpm run eval:compare`     | agent-core 변경 후 eval 비교         |

자세한 내용은 [README.md — 개발](README_ko.md#개발)과 각 앱/패키지 README를 참조하세요.

## Git 훅

저장소 루트의 `pnpm install`은 `prepare`를 실행하고, 로컬 `core.hooksPath`를 `.githooks`로 설정합니다. 훅은 index만 검사하며 파일을 다시 쓰지 않습니다:

- **pre-commit:** `packages` / `apps/desktop` / `apps/site` 아래 스테이징된 TypeScript에 `oxlint --deny-warnings`. 스테이징된 파일에 TypeScript 또는 문서가 포함되면 `oxfmt --check`(함께 스테이징된 다른 포맷 가능 경로도 따라 포함). 스테이징된 `apps/cli` `.rs` 파일에 `cargo fmt --check`. 스테이징된 blob의 보이지 않는 Unicode 검사(`scripts/check-invisible-unicode.py --staged`)
- **commit-msg:** 첫 줄이 이미 `type:` / `type(scope):` 형태이면 `:` 뒤와, 다중 scope 목록의 각 쉼표 뒤에 공백을 요구합니다. Merge, revert, 중국어, 그 밖의 자유 형식 subject는 거부하지 않습니다

`git commit --no-verify`는 훅을 건너뜁니다. 비상용으로만 사용하세요. `pnpm install`을 한 번도 실행하지 않는 Rust 전용 clone은 `git config core.hooksPath .githooks` 또는 `node scripts/setup-git-hooks.mjs`로 같은 경로를 켤 수 있습니다.

## 변경하기

1. 저장소를 Fork하고 `main`에서 feature 브랜치를 만듭니다
2. 커밋은 집중시키고, diff는 리뷰하기 쉽게 유지합니다
3. 크로스 플랫폼 호환(Windows, macOS, Linux)을 목표로 하고, 필요하면 조건부 컴파일을 포함합니다
4. Spirit은 활발한 초기 개발 단계입니다. 구성이나 영속화 형식을 바꿀 때는 무거운 호환 심보다 직접적이고 진화시키기 쉬운 구조를 우선합니다. 호환을 깨는 변경이면 이유와 마이그레이션 경로를 PR에 설명합니다

## 브랜치 이름

변경 범위가 **단일** 앱 또는 패키지일 때는 `{type}/{scope}/{description}`(슬래시로 나뉜 세 구간)을 사용합니다. `{type}/{scope}-{description}`처럼 **쓰지 마세요**.

- `type`: Conventional Commits 유형(`feat`, `fix`, `refactor`, `style`, `chore`, `ci` 등)
- `scope`: 앱 또는 패키지(`desktop`, `cli`, `site`, `agent-core` 등). 커밋의 `scope`와 맞춥니다
- `description`: 짧은 kebab-case 요약

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

여러 앱이나 패키지를 건드리는 횡단 변경은 scope 구간을 생략합니다: `{type}/{description}`.

## 커밋 메시지

이 프로젝트는 [Conventional Commits](https://www.conventionalcommits.org/)를 사용합니다:

- `type`과 선택적 `scope`는 영어(예: `feat(desktop)`, `fix(agent-core)`)
- **subject와 body는 영어**. subject는 한 줄이며, 끝에 마침표를 붙이지 않습니다
- body는 선택입니다. 쓸 경우 변경에 맞는 형식을 고릅니다. 요약형 요점은 한 줄에 하나인 `-` 목록, 이유가 필요하면 이어지는 산문 단락

예:

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

메인테이너와 에이전트 쪽 커밋 규약은 [AGENTS.md](../AGENTS.md)에 있습니다.

## 테스트와 CI

push마다 [Verify 워크플로](../.github/workflows/verify.yml)가 실행됩니다:

- `pnpm turbo run build`(TypeScript 패키지, Desktop, site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` 및 `pnpm exec oxfmt --check packages apps/desktop apps/site`
- CLI의 `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`

PR을 열기 전에, 해당하는 경우 로컬에서 실행합니다:

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # 커밋 전
pnpm --filter @spiritagent/agent-core test   # agent-core를 변경한 경우
cargo test -p spirit                   # CLI를 변경한 경우
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # 모델에 보이는 agent-core 동작을 변경한 경우
```

## Agent-core와 모델에 보이는 변경

시스템 프롬프트, 도구 정의, 컨텍스트 주입의 변경은 모든 호스트에서 에이전트 동작에 영향을 줄 수 있습니다. 큰 편집에서는:

- `pnpm run eval:compare`를 실행하고 결과를 검토합니다
- LLM에 보이는 문구는 기본적으로 영어로 유지합니다
- [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)를 따릅니다

작은 문장 수정, 철자 수정, 모델에 보이지 않는 리팩터는 보통 전체 eval 실행이 필요 없습니다.

## Pull Request

- 명확한 제목과 설명을 씁니다. **무엇을** 바꿨는지, **왜**인지, **어떻게 테스트했는지**
- PR이 Issue를 닫기 위한 것이면, 설명의 마지막을 독립된 한 줄 `Closed #N` 또는 `Fixed #N`으로 끝냅니다(그 위에 빈 줄). [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)를 참조하세요
- diff는 집중시킵니다. 관련 없는 정리는 별도 PR로 둡니다
- 리뷰 피드백에는 제때 응답합니다

## 더 읽어보기

- [AGENTS.md](../AGENTS.md) — 아키텍처 노트, LLM 규약, 컨텍스트 push/pull 전략
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## 라이선스

기여함으로써, 자신의 기여가 [MIT License](../LICENSE)에 따라 라이선스되는 데 동의하게 됩니다.
