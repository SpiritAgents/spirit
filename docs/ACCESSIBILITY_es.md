# Accesibilidad en Spirit

Última actualización: 2026-11-18

[English](../ACCESSIBILITY.md) · [简体中文](ACCESSIBILITY_zh-CN.md) · [繁體中文](ACCESSIBILITY_zh-TW.md) · [日本語](ACCESSIBILITY_ja.md) · [한국어](ACCESSIBILITY_ko.md) · [Deutsch](ACCESSIBILITY_de.md) · [Français](ACCESSIBILITY_fr.md) · [Português do Brasil](ACCESSIBILITY_pt-BR.md) · [Русский](ACCESSIBILITY_ru.md)

Spirit está en desarrollo activo. Esta declaración registra el trabajo actual de accesibilidad, los flujos de trabajo compatibles y la cobertura de verificación.

## Prioridades y trabajo actual

El trabajo actual de accesibilidad de Spirit prioriza el manejo con teclado, el foco visible, la semántica significativa de los controles y la reducción del movimiento en el Workbench de React compartido por Desktop y el host web opcional.

La [PR n.º 437: fix(web): improve keyboard navigation and focus indicators](https://github.com/SpiritAgents/spirit/pull/437) implementó y probó el siguiente comportamiento en las vistas cubiertas:

- [Primitivas de foco itinerante](../packages/ui/src/roving-focus-group.tsx) compartidas para listas lineales, cuadrículas visuales, listas virtualizadas y acciones de la fila actual.
- Navegación con teclas de dirección, y con Inicio y Fin donde está implementada, en listas de modelos y proveedores, pestañas y catálogos de fuentes de extensiones, listas e historiales de automatizaciones, árboles de archivos del espacio de trabajo, listas de Git, pestañas de herramientas y la barra lateral de sesiones.
- Un único punto de entrada principal con Tab para las listas compuestas cubiertas, manteniendo las acciones de la fila actual accesibles con teclado.
- Detalles de elementos activados por el foco del teclado en la implementación compartida de tooltips, con cierre al perder el foco o pulsar Escape y descripciones asociadas mediante `aria-describedby`.
- Indicadores de foco diferenciados del estilo de hover del puntero, incluidas las filas de la barra lateral y las acciones integradas.

Workbench también dispone de una preferencia de reducción de movimiento con las opciones Sistema, Activado y Desactivado. La [implementación](../packages/web/src/lib/reduce-motion.ts) sigue el ajuste `prefers-reduced-motion` del sistema operativo en el modo Sistema y proporciona un estado de documento compartido por los estilos y comportamientos sensibles al movimiento.

Algunas partes de la interfaz de React usan controles nativos, roles ARIA, nombres accesibles, atributos de estado como `aria-current`, `aria-expanded` y `aria-selected`, y roles status o alert. El ayudante de iconos compartido oculta de forma predeterminada los iconos decorativos a las tecnologías de asistencia cuando no se proporcionan propiedades de accesibilidad ni contenido secundario. Esta implementación proporciona puntos de anclaje semánticos para las tecnologías de asistencia. La verificación actual se centra en el teclado y el foco.

## Expectativas para colaboradores

Las personas colaboradoras y los agentes de programación que modifiquen la interfaz interactiva deben:

- Conservar el manejo con teclado, el foco visible y los nombres, roles y estados significativos. Reutilizar los controles compartidos y las primitivas de foco itinerante existentes cuando resulten adecuados.
- Mantener separados el movimiento del foco y la activación, salvo que el patrón de control establecido los vincule explícitamente. Mantener también una ruta de teclado para las acciones que antes dependían del puntero.
- Añadir o actualizar pruebas de regresión específicas para el comportamiento modificado. Entre los ejemplos existentes figuran las [pruebas de foco itinerante](../packages/web/test/components/roving-focus-group.test.tsx), las [pruebas de listas compuestas](../packages/web/test/components/keyboard-lists.test.tsx), las [pruebas de teclado de la barra lateral](../packages/web/test/components/session-sidebar-keyboard.test.tsx) y las [pruebas de teclado del espacio de trabajo](../packages/web/test/components/workspace-keyboard.test.tsx).
- Ejecutar las comprobaciones pertinentes e indicar la cobertura de verificación. Para los cambios en Workbench están disponibles estos comandos de paquete:

```bash
pnpm --filter @spiritagent/web test
pnpm --filter @spiritagent/web typecheck
```

El [flujo de trabajo Verify](../.github/workflows/verify.yml) ejecuta compilaciones, pruebas, comprobaciones de tipos, oxlint y oxfmt de TypeScript, además de comprobaciones de Rust. Consulta la [guía de contribución](../CONTRIBUTING.md#testing-and-ci) para conocer las instrucciones generales del repositorio.

Vitest y jsdom aportan evidencia de regresión, mientras que las pruebas con tecnologías de asistencia se documentan por separado. Las solicitudes de incorporación deben identificar las comprobaciones manuales relevantes y las lagunas de verificación.

## Informar de barreras de accesibilidad

[Informa de una barrera de accesibilidad mediante el formulario de informe de errores de Spirit](https://github.com/SpiritAgents/spirit/issues/new?template=bug_report.md). Incluye «Accessibility» en el título del issue para que el informe sea fácil de reconocer.

Describe la tarea o página afectada, el comportamiento esperado y lo que ocurrió. El contexto útil puede incluir la versión de Spirit, el sistema operativo, el método de entrada, el navegador al usar el host web y cualquier tecnología de asistencia implicada. Proporciona únicamente la información que desees compartir.

Puedes informar solo con una descripción de texto. La información sobre discapacidad, las capturas de pantalla, las grabaciones y los registros son opcionales. Adjunta el material que resulte útil y desees compartir. Elimina las claves de API, tokens y rutas privadas de cualquier registro compartido.

## Respuesta y seguimiento

Los informes de accesibilidad usan el mismo flujo de trabajo de issues y solicitudes de incorporación de GitHub que otros errores de Spirit. Los mantenedores los evalúan y priorizan durante la clasificación. El estado y el debate sobre la implementación se registran en el issue y las solicitudes de incorporación vinculadas.

## Cobertura por entorno

- **Desktop:** el shell de Electron de Spirit está dirigido a Windows, macOS y Linux.
- **Host web:** Desktop y el host web opcional comparten el renderizador React Workbench y su suite de regresión para el foco de teclado.
- **Entrada por teclado:** las pruebas automatizadas cubren los comportamientos específicos de navegación y foco descritos anteriormente en el Workbench de React compartido.
- **Lectores de pantalla y otras tecnologías de asistencia:** el código fuente incluye controles semánticos, nombres accesibles, atributos de estado y elementos de estado dinámico. Los resultados detallados para tecnologías concretas pueden añadirse a medida que se verifiquen.
- **CLI e interfaz de terminal:** Spirit incluye una CLI de Rust y una interfaz de terminal opcional. La evaluación de su accesibilidad sigue siendo un área abierta.

## Lagunas actuales de cobertura

- El trabajo de teclado de la PR n.º 437 cubre vistas concretas de React y primitivas compartidas. El contenido del editor Monaco, los terminales integrados, el navegador dentro de la aplicación, la interfaz aportada por extensiones y otros contenidos integrados o de terceros son áreas de evaluación adicionales.
- Los mensajes transmitidos, las actualizaciones dinámicas, los diálogos y el contenido complejo quedan pendientes de evaluación de extremo a extremo con lectores de pantalla. Las pruebas existentes se centran en roles DOM e interacciones de teclado.

## Responsabilidad y mantenimiento

Los mantenedores de Spirit revisan los cambios de esta declaración mediante el proceso habitual de solicitudes de incorporación del proyecto.

Los colaboradores que modifiquen el comportamiento compatible, la cobertura de pruebas o las barreras conocidas deben proponer actualizaciones correspondientes de esta declaración en la misma solicitud de incorporación. Las traducciones deben conservar la distinción de la versión inglesa entre el comportamiento implementado y su estado de verificación.

## Comentarios y mejoras

Para sugerir mejoras de esta declaración o de las prácticas de accesibilidad de Spirit, [abre una solicitud de función](https://github.com/SpiritAgents/spirit/issues/new?template=feature_request.md) o propón una solicitud de incorporación de documentación centrada. Para un problema activo al usar Spirit, utiliza la [ruta para informar de barreras de accesibilidad](#informar-de-barreras-de-accesibilidad) indicada anteriormente.
