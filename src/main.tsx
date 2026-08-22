import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry, Sentry } from "@/lib/sentry";

initSentry();

function ErrorFallback({ resetError }: { resetError: () => void }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-md border border-border/60 bg-card p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The app encountered an unexpected UI error. Sensitive wallet data is filtered
          before error reports are sent.
        </p>
        <button
          type="button"
          onClick={resetError}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Reload UI
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback resetError={resetError} />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
