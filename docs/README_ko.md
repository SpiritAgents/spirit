<div align="center">

# Spirit

생산성을 배가시키기 위해 만들어진 오픈소스 AI 에이전트.

[Desktop 앱](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [개발](#개발)

> 본 프로젝트는 활발히 개발 중입니다. 릴리스 간 동작과 API가 변경될 수 있습니다.

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## 개요

Spirit는 실제 프로젝트 루트를 컨텍스트로 동작하는 **도구 기반 코딩 에이전트**입니다. 동일한 런타임이 네이티브 Desktop 워크스페이스와 터미널 UI를 모두 구동합니다. 공유 로직은 TypeScript 패키지에 있으며, 각 호스트가 플랫폼별 실행·탐색·UI를 추가합니다.

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

[`packages/agent-core`](../packages/agent-core)는 이 저장소에서 **에이전트 의미론의 단일 소스**이며, 호스트들이 이를 소비합니다.

### 런타임과 모드

- **Turn machine** — 스트리밍 응답, 도구 라운드, 컨텍스트 압축, 사용량 추적.
- **Agent / Plan / Ask / Debug 모드** — 전체 도구, 계획 전용 워크플로, 계약 계층에서 편집 도구를 제거한 읽기 전용 Q&A, 또는 로그 포인트 가설을 활용한 구조화된 디버깅.
- **Subagents** — `subagent`가 독립 도구 표면을 가진 하위 실행에 작업 위임.
- **루프 제어** — 멀티태스크형 루프 활성화 시 선택적 `finish_task`.
- **되감기 가능한 기록** — 호스트 측 롤백 및 재제출을 위한 메시지 아카이브 형식.

### 모델 트랜스포트

Agent Core는 단일 런타임 뒤에서 여러 추론 트랜스포트를 라우팅합니다:

| 트랜스포트            | 대표 프로바이더                                                         |
| --------------------- | ----------------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, 사용자 정의 엔드포인트 |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba(百炼)          |
| **Anthropic**         | Messages API를 통한 Claude                                              |

프로바이더 네이티브 기능(예: Open Responses 웹 검색, Alibaba 내장 검색·코드 인터프리터)은 요청의 `tools` 필드로 주입됩니다.

### 호스트 도구 계약

내장 도구는 Agent Core에서 한 번 정의(이름, 설명, JSON Schema)하고 호스트가 실행합니다:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch`(지원 트랜스포트에서 V4A), `glob`, `grep`, `ls`
- **Shell** — 호스트 제어 승인이 있는 `shell`
- **Web** — `web_fetch`; 검색은 프로바이더 도구 또는 구성된 호스트 검색
- **Delegation** — `subagent`
- **Planning** — `create_plan`, 세션 TODO 도구(`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — 워크스페이스 메모리 요약용 `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete`
- **LSP** — 편집 후 언어 서버 진단

### 시스템 컨텍스트 조립

Agent Core가 모델이 보는 프로젝트 컨텍스트를 결정합니다:

- **Rules** — `AGENTS.md`, `.spirit/rule.md`, 사용자 규칙 슬롯을 system 섹션에 병합.
- **Skills** — 카탈로그 및 활성 Skill 주입; 호스트가 디스크에서 파일 탐색.
- **MCP** — Model Context Protocol 클라이언트, 레지스트리, tool/resource/prompt 브리지.
- **Mode prompts** — Agent, Plan, Ask, Debug 경계; system 텍스트에서 도구 재나열 금지.

### 품질과 평가

- **Smoke 스위트** — `packages/agent-core/src/smoke`의 계약, 런타임, 라이브 프로바이더 검사.
- **Eval 하네스** — 프롬프트 또는 도구 정의 변경에 대한 시나리오 비교(저장소 루트에서 `pnpm run eval:compare`).

`@spiritagent/agent-core`는 npm에 게시됩니다. [`packages/host-internal`](../packages/host-internal)은 Desktop 공유 호스트 탐색, 확장, 마켓플레이스, 워크스페이스 헬퍼, LSP 오케스트레이션을 담당합니다.

## Desktop

[Desktop 앱](../apps/desktop)은 주요 그래픽 호스트: 워크스페이스에 묶인 IDE 표면과 대화형 에이전트.

- **도킹 패널** — Monaco 에디터 파일 탐색기, 내장 터미널(Electron), Git 변경 및 기록, 로컬 개발 서버용 앱 내 브라우저.
- **세션** — 다중 대화 기록, 세션별 worktree 워크플로, 도구 승인, 서브에이전트 뷰어, 구조화 설문, 컨텍스트 사용량, rewind.
- **설정** — 모델 프로바이더 및 API 키, Skills 및 Rules, MCP 서버, 확장 마켓플레이스, Dreams(beta), LSP, 테마, UI 언어(영어 / 간체 중국어 / 한국어 등).
- **플랫폼** — Windows, macOS, Linux의 Electron; 원격 페어링 가능 Web 호스트.

Desktop 전용 개발 및 레이아웃은 [apps/desktop/README.md](../apps/desktop/README.md) 참조.

## Site

[마케팅/문서 사이트](../apps/site)는 Next.js + Fumadocs 앱(`@spiritagent/site`)이며 Vercel에 배포합니다.

```bash
pnpm run dev:site
```

로컬 개발과 Vercel 저장소 전환 절차는 [apps/site/README.md](../apps/site/README.md)를 참조하세요.

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

[Rust CLI](../apps/cli)(`spirit`)는 터미널 우선 호스트로 선택적 Ratatui UI를 제공합니다. WebSocket으로 공유 Spirit Server 데몬에 연결하며, 스크립팅, SSH 세션, 최소 환경에 적합합니다.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server)(`@spiritagent/server`, bin `spirit-server` / `spirit serve`)는 퍼스트파티 호스트를 위한 **공유 데몬 백엔드**입니다. CLI와 Desktop은 프로세스 내에 런타임을 내장하는 대신 WebSocket(JSON-RPC 2.0)으로 같은 데몬에 연결합니다. 터미널에서 시작한 세션이 Desktop으로 실시간 스트리밍되고, 그 반대도 마찬가지입니다.

- **단일 진실 공급원** — 세션, 스트리밍 이벤트, 도구 실행, 승인 큐는 모두 데몬에 있고, 클라이언트는 렌더링과 입력만 담당합니다.
- **랜덤 포트 인스턴스** — `127.0.0.1`의 OS 할당 포트에 바인딩하고 `{spiritDataDir}/server/instances/`에 등록합니다. 클라이언트는 실행 중인 인스턴스에 우선 연결하고, 없으면 새로 시작합니다. `spirit-server ps` / `kill`로 인스턴스를 관리합니다.
- **Bearer 인증** — 홈 레벨 토큰은 `{spiritDataDir}/server.token`(권한 0600)에 저장되며 `Authorization` 헤더 또는 `?token=` 쿼리로 전달합니다. `spirit-server rotate-token`으로 교체하면 새 연결부터 적용됩니다.
- **신규 의존성 없음** — WebSocket 계층(RFC 6455)을 패키지 내부에 구현했습니다.

**CLI와 Desktop의 에이전트 실행은 daemon-only**입니다([Epic #274](https://github.com/SpiritAgents/spirit/issues/274) 참조). Desktop Web Host 클라이언트는 Desktop 호스트의 인증된 스냅샷 push를 받으며, 에이전트 실행은 데몬에 남습니다. 원격 접속(`--hostname 0.0.0.0`)은 향후 단계를 위해 예약되어 있으며 기본적으로 꺼져 있습니다.

## ACP Server

[`packages/acp-server`](../packages/acp-server)는 얇은 어댑터로, stdio / ndJSON을 통해 Spirit를 [Agent Client Protocol](https://agentclientprotocol.com)(ACP) 서버로 노출합니다. **Zed**나 **JetBrains Junie** 같은 ACP 호환 에디터가 맞춤 통합 없이 Spirit를 AI 코딩 엔진으로 연결할 수 있습니다.

- **Terminal Auth** — `initialize`가 `type: "terminal"` 인증 선언; 클라이언트는 `spirit-acp --setup`으로 대화형 provider 구성 후 `authenticate` → `session/new`.
- **프로토콜 표면** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **스트리밍 및 사고** — 실시간 `agent_message_chunk`와 추론 출력용 `agent_thought_chunk`.
- **권한 브리지** — ACP `request_permission`으로 도구 승인(allow-once / always-allow / reject).
- **Slash 명령** — 워크스페이스 및 사용자 Skills를 `available_commands_update`로 등록; `/skill-name`으로 Skill 활성화 및 system 프롬프트 주입.
- **로컬 실행** — `NodeHostToolService`로 프로세스 내 실행(stdio는 ACP ndJSON 전용).

### 빠른 시작(Zed)

1. 서버 빌드: `pnpm run build:acp-server`
2. Zed `settings.json`에 추가(`env`에 API 키 불필요):

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. 인증 프롬프트에서 **Run in terminal** 선택 → `--setup` 실행, provider·자격 증명·모델 선택.
4. Setup은 Spirit 공유 데이터 디렉터리(`config.json` + OS keyring, Desktop/CLI와 공유)에 기록. 완료 후 클라이언트가 `authenticate` → `session/new`.

에디터 외 수동 setup:

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| 환경 변수              | 필수   | 설명                                                                   |
| ---------------------- | ------ | ---------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | 아니오 | 워크스페이스 루트(기본: 클라이언트 `cwd`)                              |
| `SPIRIT_ACP_DATA_DIR`  | 아니오 | Spirit 데이터 디렉터리(기본: `%APPDATA%/Spirit` 또는 `~/.spirit-data`) |

## 개발

**요구 사항:** Node.js 24+, pnpm 12+(`corepack enable`로 활성화). CLI 빌드에는 Rust 툴체인 필요.

| 명령                       | 설명                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `pnpm install`             | workspace 의존성 설치(저장소 루트에서 한 번)                               |
| `pnpm run dev:desktop`     | 공유 패키지 빌드 후 Desktop 시작(Vite + Electron)                          |
| `pnpm run dev:desktop:web` | Desktop 렌더러 + 브라우저 Web 호스트                                       |
| `pnpm run dev:site`        | 마케팅/문서 사이트 시작(Next.js)                                           |
| `pnpm run dev:cli`         | TUI 포함 CLI                                                               |
| `pnpm run build`           | agent-core, host-internal, server, acp-server, Desktop, site 프로덕션 빌드 |
| `pnpm run eval:compare`    | agent-core 변경 후 eval 비교 실행                                          |

### 저장소 구조

```
apps/
  desktop/           Electron + React 호스트
  site/              마케팅/문서 사이트(Next.js, Vercel)
  cli/               Rust CLI 및 TUI
packages/
  agent-core/        에이전트 런타임, 프롬프트, 도구 정의, 트랜스포트, MCP, eval
  host-internal/     공유 호스트 탐색, 도구, 확장, LSP 헬퍼
  server/            CLI / Desktop / Web용 공유 데몬 백엔드 (WebSocket + JSON-RPC)
  acp-server/        에디터 통합용 ACP 서버 어댑터
scripts/             릴리스, eval, 저장소 자동화
```

## 기여

시작하려면 [CONTRIBUTING.md](../CONTRIBUTING.md)를 참조하세요. 아키텍처 경계, 커밋 규약, agent-core 가이드라인은 [AGENTS.md](../AGENTS.md)도 읽어 보세요. 보안 이슈는 [SECURITY.md](../SECURITY.md)를 참조하세요.

## 라이선스

[MIT](../LICENSE)
