# Contribuer à Spirit

[English](../CONTRIBUTING.md) · [简体中文](CONTRIBUTING_zh-CN.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

Merci de votre intérêt pour Spirit ! Ce projet est un monorepo open source d’agent de codage orienté outils : Desktop (Electron), CLI (Rust), un daemon partagé (`packages/server`) et le runtime central (`packages/agent-core`). Que vous corrigiez la documentation, des bugs ou que vous ajoutiez des fonctionnalités, votre aide est la bienvenue. Si vous ne savez pas par où commencer, ouvrez une Issue pour dire bonjour.

## Avant de contribuer

**Ouvrez d’abord une Issue pour les changements plus importants**, afin que nous puissions nous aligner sur la direction avant que vous n’y consacriez un effort important. Exemples :

- Nouvelles fonctionnalités ou changements d’UX substantiels
- Changements d’API publique, de protocole, ou de format de config / de persistance
- Refactors qui couvrent plusieurs packages
- Changements de prompt, de contrat d’outil ou d’injection de contexte qui modifient le comportement de l’agent

**Les changements plus petits peuvent aller directement en pull request**, par exemple :

- Mises à jour de documentation, de README ou de commentaires
- Corrections d’orthographe et de style
- Corrections de bugs ciblées, avec un impact comportemental clair et limité

En cas de doute, une Issue courte est en général plus rapide qu’une grande PR à reprendre.

## Codage assisté par agent

Écrire du code avec Cursor, Copilot ou d’autres outils d’agent est bienvenu — mais **vous restez responsable du diff que vous soumettez** :

- Être en mesure d’expliquer _pourquoi_ un changement a été fait, et pas seulement qu’un modèle l’a produit
- Relire la sortie de l’agent : retirer les modifications sans rapport, la logique dupliquée et les couches défensives inutiles
- Traiter le **texte visible par le modèle** (prompts système, noms et descriptions d’outils, texte d’éval) avec un soin particulier — le garder concis, en anglais, et ne pas répéter des capacités déjà déclarées dans le champ `tools` de la requête
- Dans la description de la PR, indiquer la motivation, l’impact et la façon dont vous avez vérifié le changement

Les agents peuvent accélérer l’implémentation. Ils ne remplacent pas votre jugement.

## Architecture et périmètre

Spirit a un modèle de couches clair. Avant de toucher à plusieurs packages, lisez [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md) :

| Couche                  | Chemin                                                                            | Rôle                                                                 |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Sémantique de l’agent   | `packages/agent-core`                                                             | Runtime, prompts, contrats d’outils, MCP, transports                 |
| Logique d’hôte partagée | `packages/host-internal`                                                          | Découverte, extensions, aides d’espace de travail, orchestration LSP |
| Hôtes / adaptateurs     | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | UI et exécution fines, spécifiques à la plateforme                   |

Ne dupliquez pas les définitions d’outils ni les prompts entre le CLI et Desktop. Les nouveaux contrats d’outils vont dans `agent-core` ; l’exécution va dans l’hôte.

## Environnement de développement

**Prérequis :** Node.js 24+, pnpm 12+ (`corepack enable`), et la chaîne d’outils Rust (pour le CLI).

```bash
pnpm install          # une fois, à la racine du dépôt
pnpm run dev:desktop  # Desktop (Vite + Electron)
pnpm run dev:site     # site marketing et documentation (Next.js)
pnpm run dev:cli      # CLI avec TUI
pnpm run build        # build de production des packages TS + Desktop + site + CLI
```

Pendant `pnpm run dev:desktop`, les modifications du source des packages n’exigent pas de rebuild manuel : les packages consommés par le renderer sont servis depuis leurs sources TypeScript (HMR), et les changements du processus principal Electron sont reconstruits par des tâches watch, puis l’application redémarre automatiquement.

| Commande                    | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `pnpm run dev:desktop:web`  | Renderer Desktop avec hôte web dans le navigateur   |
| `pnpm run dev:site`         | Site marketing et documentation (Next.js)           |
| `pnpm run build:agent-core` | Build de `@spiritagent/agent-core` seulement        |
| `pnpm run build:cli`        | Build de release du CLI Rust                        |
| `pnpm run eval:compare`     | Comparaison d’éval après des changements agent-core |

Voir [README.md — Développement](README_fr.md#développement) et le README de chaque app ou package pour les détails propres au package.

## Hooks Git

`pnpm install` à la racine du dépôt exécute `prepare`, qui définit le `core.hooksPath` local sur `.githooks`. Les hooks ne contrôlent que l’index et ne réécrivent jamais les fichiers :

- **pre-commit :** `oxlint --deny-warnings` sur le TypeScript indexé sous `packages` / `apps/desktop` / `apps/site` ; `oxfmt --check` lorsque les fichiers indexés comprennent du TypeScript ou de la documentation (les autres chemins indexés formatables qui suivent sont inclus) ; `cargo fmt --check` sur les fichiers `.rs` indexés de `apps/cli` ; Unicode invisible sur les blobs indexés (`scripts/check-invisible-unicode.py --staged`)
- **commit-msg :** si la première ligne a déjà la forme `type:` / `type(scope):`, un espace est exigé après `:` et après chaque virgule dans une liste à plusieurs scopes. Les subjects de merge, de revert, en chinois et les autres subjects libres ne sont pas rejetés

`git commit --no-verify` ignore les hooks ; ne l’utilisez que comme échappatoire. Un clone Rust seul, qui n’exécute jamais `pnpm install`, peut activer le même chemin avec `git config core.hooksPath .githooks` ou `node scripts/setup-git-hooks.mjs`.

## Apporter des modifications

1. Forkez le dépôt et créez une branche de fonctionnalité à partir de `main`
2. Gardez des commits ciblés et des diffs faciles à relire
3. Visez la compatibilité multiplateforme (Windows, macOS, Linux), y compris la compilation conditionnelle là où elle est nécessaire
4. Spirit est en développement précoce actif — lorsque vous changez des formats de config ou de persistance, préférez des structures directes et évolutives à de lourds shims de compatibilité ; si un changement est incompatible, expliquez la raison et le chemin de migration dans votre PR

## Noms de branche

Lorsque le changement est limité à **une seule** app ou **un seul** package, utilisez `{type}/{scope}/{description}` (trois segments séparés par des barres obliques). N’écrivez **pas** `{type}/{scope}-{description}`.

- `type` : type Conventional Commits (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …)
- `scope` : l’app ou le package (`desktop`, `cli`, `site`, `agent-core`, …), identique au `scope` du commit
- `description` : court résumé en kebab-case

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Les changements transverses qui touchent plusieurs apps ou packages omettent le segment de scope : `{type}/{description}`.

## Messages de commit

Ce projet utilise [Conventional Commits](https://www.conventionalcommits.org/) :

- `type` et `scope` facultatif en anglais (par exemple `feat(desktop)`, `fix(agent-core)`)
- **Subject et corps en anglais** ; le subject tient sur une ligne, sans point final
- Le corps est facultatif ; s’il est présent, choisissez le format qui convient au changement : une liste `-` (un élément par ligne) pour des points de synthèse, ou des paragraphes de prose continue lorsque le changement a besoin que sa raison soit expliquée

Exemple :

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

Les conventions de commit côté mainteneurs et côté agent sont documentées dans [AGENTS.md](../AGENTS.md).

## Tests et CI

Chaque push exécute le [workflow Verify](../.github/workflows/verify.yml) :

- `pnpm turbo run build` (packages TypeScript, Desktop et site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` et `pnpm exec oxfmt --check packages apps/desktop apps/site`
- `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings` et `cargo test` pour le CLI

Avant d’ouvrir une PR, exécutez localement ce qui est pertinent :

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # avant le commit
pnpm --filter @spiritagent/agent-core test   # si vous avez modifié agent-core
cargo test -p spirit                   # si vous avez modifié le CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # si vous avez modifié un comportement d’agent-core visible par le modèle
```

## Agent-core et modifications visibles par le modèle

Les changements de prompts système, de définitions d’outils ou d’injection de contexte peuvent affecter le comportement de l’agent sur tous les hôtes. Pour des modifications substantielles :

- Exécutez `pnpm run eval:compare` et examinez les résultats
- Gardez par défaut le texte visible par le LLM en anglais
- Suivez [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

Les petites corrections de formulation, d’orthographe, ou les refactors non visibles par le modèle n’ont en général pas besoin d’une éval complète.

## Pull requests

- Utilisez un titre et une description clairs : **ce qui** a changé, **pourquoi**, et **comment vous l’avez testé**
- Lorsque la PR est destinée à fermer une Issue, terminez la description par une dernière ligne isolée `Closed #N` ou `Fixed #N` (une ligne vide au-dessus). Voir [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- Gardez le diff ciblé — les nettoyages sans rapport vont dans une PR séparée
- Répondez aux retours de revue dans un délai raisonnable

## Pour aller plus loin

- [AGENTS.md](../AGENTS.md) — notes d’architecture, conventions LLM et stratégie de push/pull du contexte
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## Licence

En contribuant, vous acceptez que vos contributions soient sous licence [MIT License](../LICENSE).
