import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportFatalRendererError } from "@/lib/renderer-error-reporting";

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  error: Error | null;
};

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the Vite document alive so React Refresh can retry after the next
    // edit. Navigating to the native crash page would disconnect the HMR client.
    if (import.meta.env.PROD || !import.meta.hot) {
      reportFatalRendererError(error, info.componentStack ?? undefined);
    }
  }

  render() {
    if (this.state.error) {
      // Desktop replaces this fallback with the full native crash page. Keep a
      // readable error if the IPC bridge is unavailable (for example, web hosts).
      return (
        <pre
          role="alert"
          className="m-0 min-h-screen overflow-auto bg-background p-6 text-sm whitespace-pre-wrap text-foreground"
        >
          {this.state.error.stack ?? this.state.error.message}
        </pre>
      );
    }
    return this.props.children;
  }
}
