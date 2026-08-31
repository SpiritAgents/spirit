<div align="center">

# Spirit

Un agente de IA de código abierto diseñado para multiplicar tu productividad.

[Aplicación Desktop](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Desarrollo](#desarrollo)

> Este proyecto está en desarrollo activo. El comportamiento y las API pueden cambiar entre versiones.

[English](../README.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## Descripción general

Spirit es un **agente de codificación basado en herramientas** que se ejecuta sobre la raíz de un proyecto real. El mismo runtime impulsa un workspace Desktop nativo y una interfaz de terminal. La lógica compartida vive en paquetes TypeScript; los hosts añaden ejecución, descubrimiento e interfaz específicos de plataforma.

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

[`packages/agent-core`](../packages/agent-core) es la **única fuente de la semántica del agente** en este repositorio. Los hosts la consumen.

### Runtime y modos

- **Turn machine** — salida del asistente en streaming, rondas de herramientas, compactación y seguimiento de uso del contexto.
- **Modos Agent / Plan / Ask / Debug** — acceso completo a herramientas, flujos solo de planificación, Q&A de solo lectura sin herramientas de edición a nivel de contrato o depuración estructurada con hipótesis de puntos de registro.
- **Subagents** — `subagent` delega trabajo enfocado a ejecuciones hijas con su propia superficie de herramientas.
- **Control de bucle** — `finish_task` opcional cuando el bucle multitarea está habilitado.
- **Historial compatible con rewind** — formatos de archivo diseñados para rollback y reenvío en el host.

### Transportes de modelo

Agent Core enruta la inferencia a través de varios transportes detrás de un runtime unificado:

| Transporte            | Proveedores típicos                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, endpoints personalizados |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian)        |
| **Anthropic**         | Claude vía Messages API                                                   |

Las capacidades nativas del proveedor (búsqueda web en Open Responses, búsqueda e intérprete de código de Alibaba, etc.) se inyectan mediante el campo `tools`.

### Contratos de herramientas del host

Las herramientas integradas se definen una vez en Agent Core (nombre, descripción, JSON Schema). Los hosts ejecutan:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A en transportes compatibles), `glob`, `grep`, `ls`
- **Shell** — `shell` con aprobación controlada por el host
- **Web** — `web_fetch`; búsqueda vía herramientas del proveedor o búsqueda del host configurada
- **Delegation** — `subagent`
- **Planning** — `create_plan`, herramientas TODO de sesión (`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` para resúmenes de memoria del workspace
- **LSP** — diagnósticos del language server tras ediciones

### Ensamblado del contexto del sistema

Agent Core decide cómo el modelo ve el contexto del proyecto:

- **Rules** — `AGENTS.md`, `.spirit/rule.md` y ranuras de reglas de usuario fusionadas en secciones system.
- **Skills** — catálogo e inyección de skill activo; los hosts descubren archivos en disco.
- **MCP** — cliente Model Context Protocol, registro y puente tool/resource/prompt.
- **Mode prompts** — límites Agent, Plan, Ask y Debug sin repetir herramientas en el texto system.

### Calidad y evaluación

- **Suites smoke** — comprobaciones de contrato, runtime y proveedor en vivo en `packages/agent-core/src/smoke`.
- **Harness eval** — comparación de escenarios para cambios de prompts o definiciones de herramientas (`pnpm run eval:compare` en la raíz).

`@spiritagent/agent-core` se publica en npm; [`packages/host-internal`](../packages/host-internal) contiene descubrimiento compartido del host, extensiones, helpers de workspace y orquestación LSP para Desktop.

## Desktop

La [aplicación Desktop](../apps/desktop) es el host gráfico principal: superficie IDE ligada al workspace con agente conversacional.

- **Paneles acoplados** — explorador de archivos con editor Monaco, terminal integrado (Electron), cambios e historial Git, navegador in-app para servidores de desarrollo locales.
- **Sesiones** — historial multi-conversación, flujos worktree por sesión, aprobación de herramientas, visor de subagentes, cuestionarios estructurados, uso de contexto y rewind.
- **Configuración** — proveedores de modelos y claves API, Skills y Rules, servidores MCP, extensiones, Dreams (beta), LSP, temas e idioma de UI (inglés / chino simplificado / español, etc.).
- **Plataformas** — Electron en Windows, macOS y Linux; host web opcional con emparejamiento remoto.

Consulta [apps/desktop/README.md](../apps/desktop/README.md) para desarrollo específico de Desktop.

## Site

El [sitio de marketing y documentación](../apps/site) es una app Next.js + Fumadocs (`@spiritagent/site`), desplegada en Vercel.

```bash
pnpm run dev:site
```

Consulta [apps/site/README.md](../apps/site/README.md) para desarrollo local y el cambio de repositorio en Vercel.

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

La [CLI en Rust](../apps/cli) (`spirit`) ofrece un host orientado a terminal con UI Ratatui opcional. Se conecta al daemon compartido Spirit Server por WebSocket, ideal para scripts, sesiones SSH y entornos mínimos.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](../packages/server) (`@spiritagent/server`, bin `spirit-server` / `spirit serve`) es el **backend demonio compartido** para los hosts first-party. CLI y Desktop ya no incrustan un runtime en su proceso: se conectan al mismo demonio por WebSocket (JSON-RPC 2.0), de modo que una sesión iniciada en la terminal se transmite en vivo a Desktop, y viceversa.

- **Fuente única de verdad** — sesiones, eventos de streaming, ejecución de herramientas y colas de aprobación viven en el demonio; los clientes solo renderizan y envían entradas.
- **Instancias en puerto aleatorio** — escucha en `127.0.0.1` con un puerto asignado por el SO y se registra en `{spiritDataDir}/server/instances/`; los clientes se adjuntan preferentemente a una instancia viva o lanzan una nueva. `spirit-server ps` / `kill` gestionan las instancias.
- **Auth Bearer** — token a nivel de home en `{spiritDataDir}/server.token` (modo 0600), aceptado vía cabecera `Authorization` o query `?token=`; `spirit-server rotate-token` lo rota para las conexiones nuevas.
- **Sin dependencias nuevas** — la capa WebSocket (RFC 6455) está implementada dentro del paquete.

**CLI y Desktop son daemon-only para la ejecución del agente** (ver [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)). Los clientes Desktop Web Host reciben snapshots autenticados desde el host Desktop mientras la ejecución del agente permanece en el daemon. El acceso remoto (`--hostname 0.0.0.0`) está reservado para una fase futura y desactivado por defecto.

## ACP Server

[`packages/acp-server`](../packages/acp-server) es un adaptador ligero que expone Spirit como servidor [Agent Client Protocol](https://agentclientprotocol.com) (ACP) vía stdio / ndJSON. Cualquier editor compatible con ACP — como **Zed** o **JetBrains Junie** — puede conectar Spirit como motor de codificación IA sin integración personalizada.

- **Terminal Auth** — `initialize` anuncia auth `type: "terminal"`; los clientes ejecutan `spirit-acp --setup` para configuración interactiva del provider, luego `authenticate` antes de `session/new`.
- **Superficie del protocolo** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming y razonamiento** — `agent_message_chunk` en tiempo real y `agent_thought_chunk` para la salida de razonamiento del modelo.
- **Puente de permisos** — aprobación de herramientas vía ACP `request_permission` (allow-once / always-allow / reject).
- **Comandos slash** — Skills de workspace y usuario vía `available_commands_update`; `/skill-name` activa el skill e inyecta instrucciones.
- **Ejecución local** — herramientas in-process vía `NodeHostToolService` (stdio reservado para ndJSON ACP).

### Inicio rápido (Zed)

1. Compilar el servidor: `pnpm run build:acp-server`
2. Añadir en `settings.json` de Zed (sin clave API en `env`):

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. Al autenticar, elegir **Run in terminal** → `--setup`: provider, credenciales, modelo.
4. Setup escribe en el directorio de datos Spirit compartido (`config.json` + keyring del SO, igual que Desktop/CLI). Luego `authenticate`, luego `session/new`.

Setup manual fuera del editor:

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| Variable de entorno    | Requerida | Descripción                                                                        |
| ---------------------- | --------- | ---------------------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | No        | Raíz del workspace (predeterminado: `cwd` del cliente)                             |
| `SPIRIT_ACP_DATA_DIR`  | No        | Directorio de datos Spirit (predeterminado: `%APPDATA%/Spirit` o `~/.spirit-data`) |

## Desarrollo

**Requisitos:** Node.js 24+, pnpm 11+ (activar con `corepack enable`). Toolchain Rust necesaria para compilar la CLI.

| Comando                    | Descripción                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install`             | Instalar dependencias del workspace (una vez en la raíz)                             |
| `pnpm run dev:desktop`     | Compilar paquetes compartidos e iniciar Desktop (Vite + Electron)                    |
| `pnpm run dev:desktop:web` | Renderer Desktop con host web en navegador                                           |
| `pnpm run dev:site`        | Iniciar el sitio de marketing/docs (Next.js)                                         |
| `pnpm run dev:cli`         | CLI con TUI                                                                          |
| `pnpm run build`           | Build de producción de agent-core, host-internal, server, acp-server, Desktop y site |
| `pnpm run eval:compare`    | Comparación eval tras cambios en agent-core                                          |

### Estructura del repositorio

```
apps/
  desktop/           Host Electron + React
  site/              Sitio de marketing y docs (Next.js, Vercel)
  cli/               CLI Rust y TUI
packages/
  agent-core/        Runtime del agente, prompts, definiciones de herramientas, transports, MCP, eval
  host-internal/     Descubrimiento compartido del host, herramientas, extensiones, helpers LSP
  server/            Backend demonio compartido (WebSocket + JSON-RPC) para CLI / Desktop / Web
  acp-server/        Adaptador de servidor ACP para integración con editores
scripts/             Release, eval y automatización del repo
```

## Contribuir

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para empezar. Para límites de arquitectura, convenciones de commit y guía agent-core, lee también [AGENTS.md](../AGENTS.md). Para reportar problemas de seguridad, consulta [SECURITY.md](../SECURITY.md).

## Licencia

[MIT](../LICENSE)
