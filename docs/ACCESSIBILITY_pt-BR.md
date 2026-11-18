# Acessibilidade no Spirit

Última atualização: 2026-11-18

[English](../ACCESSIBILITY.md) · [简体中文](ACCESSIBILITY_zh-CN.md) · [繁體中文](ACCESSIBILITY_zh-TW.md) · [日本語](ACCESSIBILITY_ja.md) · [한국어](ACCESSIBILITY_ko.md) · [Deutsch](ACCESSIBILITY_de.md) · [Français](ACCESSIBILITY_fr.md) · [Español](ACCESSIBILITY_es.md) · [Русский](ACCESSIBILITY_ru.md)

O Spirit está em desenvolvimento ativo. Esta declaração registra o trabalho atual de acessibilidade, os fluxos de trabalho suportados e a cobertura de verificação.

## Prioridades e trabalho atual

O trabalho atual de acessibilidade do Spirit prioriza a operação por teclado, o foco visível, a semântica significativa dos controles e a redução de movimento no Workbench React compartilhado pelo Desktop e pelo host web opcional.

O [PR nº 437: fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) implementou e testou os seguintes comportamentos nas visualizações cobertas:

- [Primitivas de foco móvel](../packages/ui/src/roving-focus-group.tsx) compartilhadas para listas lineares, grades visuais, listas virtualizadas e ações da linha atual.
- Navegação por teclas de seta, com Home e End onde implementado, em listas de modelos e provedores, abas e catálogos de fontes de extensões, listas e históricos de automações, árvores de arquivos do workspace, listas do Git, abas de ferramentas e barra lateral de sessões.
- Um único ponto de entrada principal por Tab para as listas compostas cobertas, mantendo as ações da linha atual acessíveis pelo teclado.
- Detalhes de itens acionados pelo foco do teclado na implementação compartilhada de tooltip, incluindo fechamento ao perder o foco ou pressionar Escape e associação das descrições por `aria-describedby`.
- Indicadores de foco distintos do estilo de hover do ponteiro, incluindo linhas da barra lateral e ações embutidas.

O Workbench também tem uma preferência de redução de movimento com as opções Sistema, Ativado e Desativado. A [implementação](../packages/web/src/lib/reduce-motion.ts) segue a configuração `prefers-reduced-motion` do sistema operacional no modo Sistema e fornece um estado de documento compartilhado por estilos e comportamentos sensíveis a movimento.

Partes da interface React usam controles nativos, papéis ARIA, nomes acessíveis, atributos de estado como `aria-current`, `aria-expanded` e `aria-selected`, e papéis status ou alert. O auxiliar de ícones compartilhado oculta ícones decorativos das tecnologias assistivas por padrão quando nenhuma propriedade de acessibilidade ou conteúdo filho é fornecido. Essa implementação oferece ganchos semânticos para tecnologias assistivas. A verificação atual enfatiza o comportamento do teclado e do foco.

## Expectativas para contribuidores

Contribuidores humanos e agentes de codificação que alterem a interface interativa devem:

- Preservar a operação por teclado, o foco visível e nomes, papéis e estados significativos. Reutilizar os controles compartilhados e as primitivas de foco móvel existentes quando forem adequados.
- Manter o movimento do foco separado da ativação, a menos que o padrão de controle estabelecido os vincule explicitamente. Manter também um caminho de teclado para ações que antes eram orientadas pelo ponteiro.
- Adicionar ou atualizar testes de regressão focados no comportamento alterado. Os exemplos existentes incluem [testes de foco móvel](../packages/web/test/components/roving-focus-group.test.tsx), [testes de listas compostas](../packages/web/test/components/keyboard-lists.test.tsx), [testes de teclado da barra lateral](../packages/web/test/components/session-sidebar-keyboard.test.tsx) e [testes de teclado do workspace](../packages/web/test/components/workspace-keyboard.test.tsx).
- Executar as verificações relevantes e informar o escopo da verificação. Para mudanças no Workbench, estão disponíveis os seguintes comandos de pacote:

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

O [fluxo de trabalho Verify](../.github/workflows/verify.yml) executa builds, testes, verificações de tipos, oxlint e oxfmt de TypeScript, além de verificações de Rust. Consulte o [guia de contribuição](../CONTRIBUTING.md#testing-and-ci) para as orientações gerais do repositório.

Vitest e jsdom fornecem evidências de regressão, enquanto os testes com tecnologias assistivas são registrados separadamente. Os pull requests devem identificar as verificações manuais relevantes e as lacunas de verificação.

## Relatar barreiras de acessibilidade

[Relate uma barreira de acessibilidade usando o formulário de relatório de bug do Spirit](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md). Inclua “Accessibility” no título da issue para facilitar o reconhecimento do relatório.

Descreva a tarefa ou página afetada, o comportamento esperado e o que aconteceu. O contexto útil pode incluir a versão do Spirit, o sistema operacional, o método de entrada, o navegador ao usar o host web e qualquer tecnologia assistiva envolvida. Forneça apenas o contexto que você se sentir confortável em compartilhar.

Você pode relatar apenas com uma descrição de texto. Informações sobre deficiência, capturas de tela, gravações e logs são opcionais. Inclua os materiais que ajudarem e que você se sinta confortável em compartilhar. Remova chaves de API, tokens e caminhos privados de qualquer log compartilhado.

## Resposta e acompanhamento

Os relatórios de acessibilidade usam o mesmo fluxo de issues e pull requests do GitHub que outros bugs do Spirit. Os mantenedores avaliam e priorizam os relatórios durante a triagem. O status e a discussão da implementação ficam registrados na issue e nos pull requests vinculados.

## Cobertura por ambiente

- **Desktop:** o shell Electron do Spirit tem como alvo Windows, macOS e Linux.
- **Host web:** o Desktop e o host web opcional compartilham o renderizador React Workbench e sua suíte de regressão para foco de teclado.
- **Entrada por teclado:** os testes automatizados cobrem os comportamentos específicos de navegação e foco descritos acima no Workbench React compartilhado.
- **Leitores de tela e outras tecnologias assistivas:** o código-fonte inclui controles semânticos, nomes acessíveis, atributos de estado e elementos de status dinâmico. Resultados detalhados para tecnologias assistivas específicas podem ser adicionados à medida que forem verificados.
- **CLI e interface de terminal:** o Spirit inclui uma CLI em Rust e uma interface de terminal opcional. A avaliação de acessibilidade desses hosts continua sendo uma área aberta.

## Lacunas atuais de cobertura

- O trabalho de teclado no PR nº 437 cobre visualizações React e primitivas compartilhadas específicas. Conteúdo do editor Monaco, terminais incorporados, navegador dentro do app, interface fornecida por extensões e outros conteúdos incorporados ou de terceiros são áreas adicionais de avaliação.
- Mensagens transmitidas, atualizações dinâmicas, caixas de diálogo e conteúdo complexo ainda precisam de avaliação de ponta a ponta com leitores de tela. Os testes existentes se concentram em papéis DOM e interações de teclado.

## Responsabilidade e manutenção

Os mantenedores do Spirit revisam alterações desta declaração pelo processo normal de pull request do projeto.

Contribuidores que alterem comportamento suportado, cobertura de testes ou barreiras conhecidas devem propor atualizações correspondentes desta declaração no mesmo pull request. As traduções devem preservar a distinção da versão em inglês entre comportamento implementado e seu status de verificação.

## Comentários e melhorias

Para sugerir melhorias nesta declaração ou nas práticas de acessibilidade do Spirit, [abra uma solicitação de recurso](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md) ou proponha um pull request de documentação focado. Para um problema ativo ao usar o Spirit, use o [caminho de relato de barreiras de acessibilidade](#relatar-barreiras-de-acessibilidade) acima.
