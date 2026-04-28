import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // DSN 미설정 시 no-op
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
  initialized = true;
}

export const ErrorBoundary = Sentry.ErrorBoundary;
export const captureException = Sentry.captureException;
export const captureMessage = Sentry.captureMessage;
