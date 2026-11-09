import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createLogger } from "@/backend/logger";

export interface ApiErrorOptions {
  status: number;
  error: string;
  message?: string;
  code?: string;
  cause?: unknown;
}

/**
 * Build a safe public error response and emit the private diagnostic under the
 * same unique id. Callers may expose deliberate validation details through
 * `message`; `cause` is logged server-side only.
 */
export type ApiErrorResponder = ReturnType<typeof createApiErrorResponder>;

export function createApiErrorResponder(scope: string) {
  const log = createLogger(scope);

  return ({ status, error, message, code, cause }: ApiErrorOptions) => {
    const errorId = randomUUID();
    const metadata = { errorId, status, error, ...(code ? { code } : {}) };
    const details = cause === undefined ? [metadata] : [metadata, cause];

    if (status >= 500) log.error("API request failed", ...details);
    else log.warn("API request rejected", ...details);

    return NextResponse.json(
      {
        success: false,
        error,
        message: message ?? error,
        errorId,
        ...(code ? { code } : {}),
      },
      { status }
    );
  };
}
