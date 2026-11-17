import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import type { GitHubAuthorizationState } from "../extension.js";
import { bridge, createPageI18n } from "./page-runtime.js";
import { GitHubAuthorizationView } from "./components/github-authorization-view.js";
import "./style.css";

async function start() {
  const view = bridge.view;
  const initial = await view.ready();
  const i18n = await createPageI18n(initial.locale);
  function App() {
    const [state, setState] = useState(initial.params as GitHubAuthorizationState);
    useEffect(
      () =>
        view.onContextChange((context) => {
          setState(context.params as GitHubAuthorizationState);
          if (i18n.language !== context.locale) void i18n.changeLanguage(context.locale);
        }),
      [],
    );
    useEffect(() => view.mounted(), []);
    return (
      <I18nextProvider i18n={i18n}>
        <GitHubAuthorizationView
          state={state}
          close={view.close}
          openExternal={view.openExternal}
        />
      </I18nextProvider>
    );
  }
  createRoot(document.getElementById("root")!, {
    onUncaughtError: (error) => view.fail(error),
  }).render(<App />);
}
void start();
