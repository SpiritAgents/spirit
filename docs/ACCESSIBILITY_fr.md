# Accessibilité de Spirit

Dernière mise à jour : 2026-11-18

[English](../ACCESSIBILITY.md) · [简体中文](ACCESSIBILITY_zh-CN.md) · [繁體中文](ACCESSIBILITY_zh-TW.md) · [日本語](ACCESSIBILITY_ja.md) · [한국어](ACCESSIBILITY_ko.md) · [Deutsch](ACCESSIBILITY_de.md) · [Español](ACCESSIBILITY_es.md) · [Português do Brasil](ACCESSIBILITY_pt-BR.md) · [Русский](ACCESSIBILITY_ru.md)

Spirit est en cours de développement actif. Cette déclaration présente les travaux d’accessibilité en cours, les workflows pris en charge et le périmètre de vérification.

## Priorités et travaux en cours

Les travaux actuels de Spirit privilégient l’utilisation au clavier, la visibilité du focus, la sémantique explicite des contrôles et la réduction des animations dans le Workbench React partagé par Desktop et l’hôte web facultatif.

La [PR n° 437 : fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) a implémenté et testé les comportements suivants dans les vues concernées :

- Des [primitives de focus itinérant](../packages/ui/src/roving-focus-group.tsx) partagées pour les listes linéaires, les grilles visuelles, les listes virtualisées et les actions de la ligne active.
- La navigation avec les touches fléchées, ainsi qu’avec Home et End lorsque cela est implémenté, dans les listes de modèles et de fournisseurs, les onglets et catalogues de sources d’extensions, les listes et historiques d’automatisations, les arborescences de fichiers de l’espace de travail, les listes Git, les onglets d’outils et la barre latérale des sessions.
- Un seul point d’entrée principal au clavier avec Tab pour les listes composites concernées, tout en laissant les actions de la ligne active accessibles au clavier.
- L’affichage des détails d’un élément lors du focus clavier dans l’implémentation partagée des infobulles, leur fermeture lors de la perte du focus ou avec Escape, et l’association des descriptions avec `aria-describedby`.
- Des indicateurs de focus distincts du style de survol du pointeur, y compris pour les lignes de la barre latérale et les actions intégrées.

Le Workbench propose également un réglage de réduction des animations avec les options Système, Activé et Désactivé. Son [implémentation](../packages/web/src/lib/reduce-motion.ts) suit le réglage `prefers-reduced-motion` du système d’exploitation en mode Système et fournit un état de document partagé par les styles et comportements sensibles aux animations.

Certaines parties de l’interface React utilisent des contrôles natifs, des rôles ARIA, des noms accessibles, des attributs d’état comme `aria-current`, `aria-expanded` et `aria-selected`, ainsi que des rôles status ou alert. L’utilitaire d’icônes partagé masque par défaut les icônes décoratives aux technologies d’assistance lorsqu’aucune propriété d’accessibilité ni contenu enfant n’est fourni. Cette implémentation fournit des repères sémantiques aux technologies d’assistance. La vérification actuelle privilégie le clavier et le focus.

## Attentes pour les contributeurs

Les contributeurs humains et les agents de codage qui modifient une interface interactive doivent :

- Préserver l’utilisation au clavier, la visibilité du focus et des noms, rôles et états explicites. Réutiliser les contrôles partagés et les primitives de focus itinérant existants lorsqu’ils conviennent.
- Séparer le déplacement du focus de l’activation, sauf si le modèle de contrôle établi les associe explicitement. Préserver également un parcours clavier pour les actions auparavant orientées pointeur.
- Ajouter ou mettre à jour des tests de régression ciblés pour le comportement modifié. Des exemples existants comprennent les [tests du focus itinérant](../packages/web/test/components/roving-focus-group.test.tsx), les [tests de listes composites](../packages/web/test/components/keyboard-lists.test.tsx), les [tests clavier de la barre latérale](../packages/web/test/components/session-sidebar-keyboard.test.tsx) et les [tests clavier de l’espace de travail](../packages/web/test/components/workspace-keyboard.test.tsx).
- Exécuter les vérifications pertinentes et indiquer le périmètre de vérification. Les commandes de package disponibles pour les changements du Workbench sont :

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

Le [workflow Verify](../.github/workflows/verify.yml) exécute les builds, tests, vérifications de types, oxlint et oxfmt pour TypeScript, ainsi que les vérifications Rust. Consultez le [guide de contribution](../CONTRIBUTING.md#testing-and-ci) pour les instructions générales du dépôt.

Vitest et jsdom fournissent des preuves de non-régression, tandis que les tests avec les technologies d’assistance sont consignés séparément. Les pull requests doivent indiquer les vérifications manuelles pertinentes et les lacunes de vérification.

## Signaler un obstacle d’accessibilité

[Signalez un obstacle d’accessibilité avec le formulaire de rapport de bogue de Spirit](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md). Ajoutez « Accessibility » au titre du ticket afin de faciliter son identification.

Décrivez la tâche ou la page concernée, le comportement attendu et le comportement constaté. Le contexte utile peut inclure la version de Spirit, le système d’exploitation, la méthode de saisie, le navigateur avec l’hôte web et toute technologie d’assistance concernée. Ne communiquez que les informations que vous souhaitez partager.

Une description textuelle suffit pour signaler un problème. Les informations sur le handicap, les captures d’écran, les enregistrements et les journaux sont facultatifs. Ajoutez les éléments utiles que vous souhaitez partager. Retirez les clés API, jetons et chemins privés de tout journal partagé.

## Traitement et suivi

Les signalements d’accessibilité suivent le même workflow de tickets et de pull requests GitHub que les autres bogues de Spirit. Les mainteneurs les évaluent et les priorisent lors du tri. Le statut et les discussions sur l’implémentation sont consignés dans le ticket et les pull requests associées.

## Périmètre par environnement

- **Desktop :** le shell Electron de Spirit cible Windows, macOS et Linux.
- **Hôte web :** Desktop et l’hôte web facultatif partagent le moteur de rendu React Workbench et sa suite de tests de régression sur le focus clavier.
- **Saisie au clavier :** les tests automatisés couvrent les comportements de navigation et de focus décrits ci-dessus dans le Workbench React partagé.
- **Lecteurs d’écran et autres technologies d’assistance :** le source comprend des contrôles sémantiques, des noms accessibles, des attributs d’état et des éléments de statut dynamique. Les résultats détaillés pour chaque technologie d’assistance pourront être ajoutés au fil de leur vérification.
- **CLI et interface de terminal :** Spirit comprend une CLI Rust et une interface de terminal facultative. L’évaluation de leur accessibilité reste un chantier ouvert.

## Lacunes actuelles de la couverture

- Les travaux sur le clavier de la PR n° 437 portent sur certaines vues React et primitives partagées. Le contenu de l’éditeur Monaco, les terminaux intégrés, le navigateur intégré, l’interface fournie par les extensions et les autres contenus intégrés ou tiers constituent des périmètres d’évaluation supplémentaires.
- Les messages diffusés en continu, mises à jour dynamiques, boîtes de dialogue et contenus complexes restent à évaluer de bout en bout avec des lecteurs d’écran. Les tests existants portent sur les rôles DOM et les interactions clavier.

## Responsabilité et maintenance

Les mainteneurs de Spirit examinent les modifications de cette déclaration selon le processus habituel des pull requests du projet.

Les contributeurs qui modifient le comportement pris en charge, la couverture des tests ou les obstacles connus doivent proposer une mise à jour correspondante de cette déclaration dans la même pull request. Les traductions doivent préserver la distinction faite en anglais entre le comportement implémenté et son état de vérification.

## Commentaires et améliorations

Pour proposer une amélioration de cette déclaration ou des pratiques d’accessibilité de Spirit, [ouvrez une demande de fonctionnalité](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md) ou une pull request de documentation ciblée. Pour un problème concret lors de l’utilisation de Spirit, utilisez le [parcours de signalement des obstacles d’accessibilité](#signaler-un-obstacle-daccessibilité) ci-dessus.
