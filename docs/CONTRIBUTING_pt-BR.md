# Contribuindo com o Spirit

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Русский](CONTRIBUTING_ru.md)

Agradecemos o seu interesse no Spirit! Este projeto é um monorepo de código aberto de um agente de codificação orientado a ferramentas: Desktop (Electron), CLI (Rust), um daemon compartilhado (`packages/server`) e o runtime central (`packages/agent-core`). Seja corrigindo a documentação, resolvendo bugs ou criando funcionalidades, sua ajuda é bem-vinda. Se você não souber por onde começar, abra uma Issue e diga olá.

## Antes de contribuir

**Abra uma Issue primeiro para mudanças maiores**, para alinharmos a direção antes de você investir um esforço significativo. Exemplos:

- Funcionalidades novas ou mudanças substanciais de UX
- Mudanças de API pública, de protocolo ou de formato de config / de persistência
- Refactors que atravessam vários pacotes
- Mudanças de prompt, de contrato de ferramenta ou de injeção de contexto que alteram o comportamento do agente

**Mudanças menores podem ir direto para um pull request**, por exemplo:

- Atualizações de documentação, README ou comentários
- Correções de ortografia e de estilo
- Correções de bugs pontuais, com impacto de comportamento claro e limitado

Na dúvida, uma Issue curta costuma ser mais rápida do que um PR grande que precisa ser refeito.

## Programação com agentes

Escrever código com Cursor, Copilot ou outras ferramentas de agente é bem-vindo — mas **você continua responsável pelo diff que envia**:

- Conseguir explicar _por que_ uma mudança foi feita, e não apenas que um modelo a produziu
- Revisar a saída do agente: remover edições não relacionadas, lógica duplicada e camadas defensivas desnecessárias
- Tratar o **texto visível ao modelo** (prompts de sistema, nomes e descrições de ferramentas, texto de eval) com cuidado extra — mantê-lo conciso, em inglês, e não repetir capacidades já declaradas no campo `tools` da requisição
- Na descrição do PR, informar a motivação, o impacto e como você verificou a mudança

Agentes podem acelerar a implementação. Eles não substituem o seu julgamento.

## Arquitetura e escopo

O Spirit tem um modelo de camadas claro. Antes de mexer em vários pacotes, leia [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md):

| Camada                       | Caminho                                                                           | Papel                                                               |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Semântica do agente          | `packages/agent-core`                                                             | Runtime, prompts, contratos de ferramentas, MCP, transports         |
| Lógica de host compartilhada | `packages/host-internal`                                                          | Descoberta, extensões, auxiliares de workspace, orquestração de LSP |
| Hosts / adaptadores          | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | UI e execução finas, específicas da plataforma                      |

Não duplique definições de ferramentas nem prompts entre a CLI e o Desktop. Contratos de ferramentas novos ficam em `agent-core`; a execução fica no host.

## Ambiente de desenvolvimento

**Requisitos:** Node.js 26.13.0, pnpm 12.4.2 (instalar com `npm install --global pnpm@12.4.2`) e a toolchain Rust (para a CLI).

```bash
pnpm install          # uma vez, na raiz do repositório
pnpm run dev:desktop  # Desktop (Vite + Electron)
pnpm run dev:site     # site de marketing e documentação (Next.js)
pnpm run dev:cli      # CLI com TUI
pnpm run build        # build de produção dos pacotes TS + Desktop + site + CLI
```

Durante `pnpm run dev:desktop`, alterações no código-fonte dos pacotes não exigem rebuild manual: os pacotes consumidos pelo renderer são servidos a partir das fontes TypeScript (HMR), e as mudanças do processo principal do Electron são reconstruídas por tarefas de watch; o app reinicia automaticamente.

| Comando                     | Descrição                                           |
| --------------------------- | --------------------------------------------------- |
| `pnpm run dev:desktop:web`  | Renderer do Desktop com host web no navegador       |
| `pnpm run dev:site`         | Site de marketing e documentação (Next.js)          |
| `pnpm run build:agent-core` | Build apenas de `@spiritagent/agent-core`           |
| `pnpm run build:cli`        | Build de release da CLI Rust                        |
| `pnpm run eval:compare`     | Comparação de eval depois de mudanças em agent-core |

Veja [README.md — Desenvolvimento](README_pt-BR.md#desenvolvimento) e o README de cada app ou pacote para detalhes específicos do pacote.

## Hooks do Git

`pnpm install` na raiz do repositório executa `prepare`, que define o `core.hooksPath` local como `.githooks`. Os hooks verificam apenas o index e nunca reescrevem arquivos:

- **pre-commit:** `oxlint --deny-warnings` no TypeScript em stage sob `packages` / `apps/desktop` / `apps/site`; `oxfmt --check` quando os arquivos em stage incluem TypeScript ou documentação (outros caminhos em stage formatáveis que entram junto também são incluídos); `cargo fmt --check` nos arquivos `.rs` em stage de `apps/cli`; Unicode invisível em blobs em stage (`scripts/check-invisible-unicode.py --staged`)
- **commit-msg:** se a primeira linha já tiver a forma `type:` / `type(scope):`, exige-se um espaço depois de `:` e depois de cada vírgula em uma lista de vários scopes. Subjects de merge, revert, em chinês e outros subjects de forma livre não são rejeitados

`git commit --no-verify` pula os hooks; use-o apenas como saída de emergência. Um clone só de Rust que nunca executa `pnpm install` pode ativar o mesmo caminho com `git config core.hooksPath .githooks` ou `node scripts/setup-git-hooks.mjs`.

## Fazer alterações

1. Faça fork do repositório e crie um branch de funcionalidade a partir de `main`
2. Mantenha commits focados e diffs fáceis de revisar
3. Busque compatibilidade entre plataformas (Windows, macOS, Linux), inclusive compilação condicional onde for necessária
4. O Spirit está em desenvolvimento inicial ativo — ao mudar formatos de config ou de persistência, prefira estruturas diretas e evolutivas a shims de compatibilidade pesados; se uma mudança for incompatível, explique o motivo e o caminho de migração no PR

## Nomes de branch

Quando a mudança se limita a **um único** app ou pacote, use `{type}/{scope}/{description}` (três segmentos separados por barras). **Não** escreva `{type}/{scope}-{description}`.

- `type`: tipo de Conventional Commits (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …)
- `scope`: o app ou pacote (`desktop`, `cli`, `site`, `agent-core`, …), igual ao `scope` do commit
- `description`: resumo curto em kebab-case

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Mudanças transversais que tocam vários apps ou pacotes omitem o segmento de scope: `{type}/{description}`.

## Mensagens de commit

Este projeto usa [Conventional Commits](https://www.conventionalcommits.org/):

- `type` e `scope` opcional em inglês (por exemplo `feat(desktop)`, `fix(agent-core)`)
- **Subject e corpo em inglês**; o subject é uma linha, sem ponto final
- O corpo é opcional; se estiver presente, use o formato que couber na mudança: uma lista `-` (um item por linha) para pontos de resumo, ou parágrafos de prosa contínua quando a mudança precisar que o motivo seja explicado

Exemplo:

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

As convenções de commit do lado de quem mantém o projeto e do lado do agente estão documentadas em [AGENTS.md](../AGENTS.md).

## Testes e CI

Cada push executa o [workflow Verify](../.github/workflows/verify.yml):

- `pnpm turbo run build` (pacotes TypeScript, Desktop e site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` e `pnpm exec oxfmt --check packages apps/desktop apps/site`
- `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings` e `cargo test` para a CLI

Antes de abrir um PR, execute localmente o que for pertinente:

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # antes do commit
pnpm --filter @spiritagent/agent-core test   # se você alterou agent-core
cargo test -p spirit                   # se você alterou a CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # se você alterou comportamento de agent-core visível ao modelo
```

## Agent-core e alterações visíveis ao modelo

Mudanças em prompts de sistema, definições de ferramentas ou injeção de contexto podem afetar o comportamento do agente em todos os hosts. Para edições substanciais:

- Execute `pnpm run eval:compare` e revise os resultados
- Mantenha o texto visível ao LLM em inglês por padrão
- Siga [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

Pequenas correções de redação ou de ortografia, ou refactors que não são visíveis ao modelo, em geral não precisam de uma execução completa de eval.

## Pull requests

- Use um título e uma descrição claros: **o que** mudou, **por quê** e **como você testou**
- Quando o PR for destinado a fechar uma Issue, termine a descrição com uma última linha isolada `Closed #N` ou `Fixed #N` (uma linha em branco acima). Veja [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- Mantenha o diff focado — limpezas sem relação ficam em um PR separado
- Responda ao feedback de review em tempo hábil

## Leitura adicional

- [AGENTS.md](../AGENTS.md) — notas de arquitetura, convenções de LLM e estratégia de push/pull de contexto
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a [MIT License](../LICENSE).
