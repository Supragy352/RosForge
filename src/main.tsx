import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950 p-8 text-slate-100">
          <div className="max-w-2xl rounded-xl border border-rose-500/40 bg-slate-900 p-6 shadow-xl">
            <h1 className="text-lg font-semibold text-rose-400">
              RosForge UI Error
            </h1>
            <pre className="mt-3 max-h-80 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-rose-200">
              {this.state.error.stack || this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
