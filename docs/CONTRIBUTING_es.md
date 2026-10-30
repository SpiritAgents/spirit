# Contribuir a Spirit

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

Gracias por tu interés en Spirit! Este proyecto es un monorepo de código abierto de un agente de codificación basado en herramientas: Desktop (Electron), CLI (Rust), un daemon compartido (`packages/server`) y el runtime central (`packages/agent-core`). Tanto si corriges documentación, como si arreglas bugs o construyes funciones nuevas, tu ayuda es bienvenida. Si no sabes por dónde empezar, abre una Issue y saluda.

## Antes de contribuir

**Abre primero una Issue para los cambios más grandes**, para que podamos alinear la dirección antes de que inviertas un esfuerzo considerable. Ejemplos:

- Funciones nuevas o cambios de UX sustanciales
- Cambios de API pública, de protocolo, o de formato de config / de persistencia
- Refactors que abarcan varios paquetes
- Cambios de prompt, de contrato de herramienta o de inyección de contexto que alteran el comportamiento del agente

**Los cambios más pequeños pueden ir directamente a un pull request**, por ejemplo:

- Actualizaciones de documentación, README o comentarios
- Correcciones de ortografía y de estilo
- Correcciones de bugs concretas, con un impacto de comportamiento claro y limitado

En caso de duda, una Issue breve suele ser más rápida que un PR grande que hay que rehacer.

## Programación con agentes

Escribir código con Cursor, Copilot u otras herramientas de agente es bienvenido, pero **sigues siendo responsable del diff que envías**:

- Poder explicar _por qué_ se hizo un cambio, y no solo que un modelo lo produjo
- Revisar la salida del agente: quitar ediciones no relacionadas, lógica duplicada y capas defensivas innecesarias
- Tratar el **texto visible para el modelo** (prompts de sistema, nombres y descripciones de herramientas, texto de eval) con cuidado adicional: mantenerlo conciso, en inglés, y no repetir capacidades ya declaradas en el campo `tools` de la solicitud
- En la descripción del PR, indicar la motivación, el impacto y cómo verificaste el cambio

Los agentes pueden acelerar la implementación. No pueden sustituir tu criterio.

## Arquitectura y alcance

Spirit tiene un modelo de capas claro. Antes de tocar varios paquetes, lee [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md):

| Capa                      | Ruta                                                                              | Rol                                                                |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Semántica del agente      | `packages/agent-core`                                                             | Runtime, prompts, contratos de herramientas, MCP, transports       |
| Lógica de host compartida | `packages/host-internal`                                                          | Descubrimiento, extensiones, ayudas de workspace, orquestación LSP |
| Hosts / adaptadores       | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | UI y ejecución delgadas, específicas de la plataforma              |

No dupliques definiciones de herramientas ni prompts entre la CLI y Desktop. Los contratos de herramientas nuevos pertenecen a `agent-core`; la ejecución pertenece al host.

## Entorno de desarrollo

**Requisitos:** Node.js 26.13.0, pnpm 12.4.2 (instalar con `npm install --global pnpm@12.4.2`) y la cadena de herramientas de Rust (para la CLI).

```bash
pnpm install          # una vez, en la raíz del repositorio
pnpm run dev:desktop  # Desktop (Vite + Electron)
pnpm run dev:site     # sitio de marketing y documentación (Next.js)
pnpm run dev:cli      # CLI con TUI
pnpm run build        # build de producción de paquetes TS + Desktop + site + CLI
```

Durante `pnpm run dev:desktop`, los cambios en el código fuente de los paquetes no necesitan un rebuild manual: los paquetes que consume el renderer se sirven desde sus fuentes TypeScript (HMR), y los cambios del proceso principal de Electron se reconstruyen mediante tareas watch y la app se reinicia sola.

| Comando                     | Descripción                                      |
| --------------------------- | ------------------------------------------------ |
| `pnpm run dev:desktop:web`  | Renderer de Desktop con host web en el navegador |
| `pnpm run dev:site`         | Sitio de marketing y documentación (Next.js)     |
| `pnpm run build:agent-core` | Build solo de `@spiritagent/agent-core`          |
| `pnpm run build:cli`        | Build de release de la CLI de Rust               |
| `pnpm run eval:compare`     | Comparación de eval tras cambios en agent-core   |

Consulta [README.md — Desarrollo](README_es.md#desarrollo) y el README de cada app o paquete para los detalles específicos del paquete.

## Hooks de Git

`pnpm install` en la raíz del repositorio ejecuta `prepare`, que establece el `core.hooksPath` local en `.githooks`. Los hooks comprueban solo el índice y nunca reescriben archivos:

- **pre-commit:** `oxlint --deny-warnings` sobre el TypeScript en stage bajo `packages` / `apps/desktop` / `apps/site`; `oxfmt --check` cuando los archivos en stage incluyen TypeScript o documentación (también entran otras rutas en stage formateables que van junto con ellas); `cargo fmt --check` sobre los archivos `.rs` en stage de `apps/cli`; Unicode invisible en los blobs en stage (`scripts/check-invisible-unicode.py --staged`)
- **commit-msg:** si la primera línea ya tiene la forma `type:` / `type(scope):`, se exige un espacio después de `:` y después de cada coma en una lista de varios scopes. Los subjects de merge, revert, en chino y otros subjects de forma libre no se rechazan

`git commit --no-verify` omite los hooks; úsalo solo como vía de escape. Un clone solo de Rust que nunca ejecuta `pnpm install` puede activar la misma ruta con `git config core.hooksPath .githooks` o `node scripts/setup-git-hooks.mjs`.

## Hacer cambios

1. Haz fork del repositorio y crea una rama de funcionalidad desde `main`
2. Mantén los commits enfocados y los diffs fáciles de revisar
3. Busca compatibilidad entre plataformas (Windows, macOS, Linux), incluida la compilación condicional donde haga falta
4. Spirit está en una fase temprana de desarrollo activo: al cambiar formatos de config o de persistencia, prefiere estructuras directas y evolucionables frente a shims de compatibilidad pesados; si un cambio es incompatible, explica el motivo y la ruta de migración en el PR

## Nombres de rama

Cuando el cambio se limita a **una sola** app o **un solo** paquete, usa `{type}/{scope}/{description}` (tres segmentos separados por barras). **No** escribas `{type}/{scope}-{description}`.

- `type`: tipo de Conventional Commits (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …)
- `scope`: la app o el paquete (`desktop`, `cli`, `site`, `agent-core`, …), igual que el `scope` del commit
- `description`: resumen breve en kebab-case

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Los cambios transversales que tocan varias apps o paquetes omiten el segmento de scope: `{type}/{description}`.

## Mensajes de commit

Este proyecto usa [Conventional Commits](https://www.conventionalcommits.org/):

- `type` y `scope` opcional en inglés (por ejemplo `feat(desktop)`, `fix(agent-core)`)
- **Subject y cuerpo en inglés**; el subject es una línea, sin punto final
- El cuerpo es opcional; si está, usa el formato que encaje con el cambio: una lista `-` (un elemento por línea) para puntos de resumen, o párrafos de prosa continua cuando el cambio necesita que se explique su motivo

Ejemplo:

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

Las convenciones de commit del lado de quienes mantienen el proyecto y del lado del agente están documentadas en [AGENTS.md](../AGENTS.md).

## Pruebas y CI

Cada push ejecuta el [workflow Verify](../.github/workflows/verify.yml):

- `pnpm turbo run build` (paquetes TypeScript, Desktop y site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` y `pnpm exec oxfmt --check packages apps/desktop apps/site`
- `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings` y `cargo test` para la CLI

Antes de abrir un PR, ejecuta en local lo que corresponda:

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # antes del commit
pnpm --filter @spiritagent/agent-core test   # si cambiaste agent-core
cargo test -p spirit                   # si cambiaste la CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # si cambiaste comportamiento de agent-core visible para el modelo
```

## Agent-core y cambios visibles para el modelo

Los cambios en prompts de sistema, definiciones de herramientas o inyección de contexto pueden afectar el comportamiento del agente en todos los hosts. Para ediciones sustanciales:

- Ejecuta `pnpm run eval:compare` y revisa los resultados
- Mantén por defecto el texto visible para el LLM en inglés
- Sigue [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

Las correcciones pequeñas de redacción o de ortografía, o los refactors no visibles para el modelo, normalmente no necesitan una ejecución completa de eval.

## Pull requests

- Usa un título y una descripción claros: **qué** cambió, **por qué** y **cómo lo probaste**
- Cuando el PR esté destinado a cerrar una Issue, termina la descripción con una última línea independiente `Closed #N` o `Fixed #N` (una línea en blanco encima). Consulta [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- Mantén el diff enfocado: las limpiezas no relacionadas van en un PR aparte
- Responde a los comentarios de revisión a tiempo

## Lectura adicional

- [AGENTS.md](../AGENTS.md) — notas de arquitectura, convenciones de LLM y estrategia de push/pull del contexto
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## Licencia

Al contribuir, aceptas que tus contribuciones se licencien bajo la [MIT License](../LICENSE).
