import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary, initSentry } from "@/lib/sentry";
import { ErrorFallback } from "@/components/ErrorFallback";
import "./styles/globals.css";

initSentry();

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback error={error} resetError={resetError} />
      )}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
