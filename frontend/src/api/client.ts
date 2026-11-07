// Talks to the Nestboard backend (server/). In development Vite forwards /api
// to it (see vite.config.ts), so requests stay on the page's own origin.

const BASE = "/api/v1";

/** Any failed request. `code` is the backend's stable error code, e.g. "version_conflict". */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The server could not be reached at all (not running, or offline). */
export const UNREACHABLE = "unreachable";

let onSignedOut: (() => void) | null = null;

/**
 * Called when a request finds the session has ended (401), so the app can
 * send the user to sign in. The /auth requests themselves are left to their
 * callers.
 */
export function whenSignedOut(handler: (() => void) | null) {
  onSignedOut = handler;
}

/** The session has ended, found some other way (e.g. the live connection closed for it). */
export function signedOut() {
  onSignedOut?.();
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw unreachable();
  }
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;
  throw failure(response, path, data);
}

/** A file the server makes, e.g. an export, with the name it suggests (if any). */
export async function requestFile(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  let response: Response;
  try {
    response = await fetch(BASE + path);
  } catch {
    throw unreachable();
  }
  if (response.ok) {
    return { blob: await response.blob(), fileName: fileNameOf(response.headers.get("content-disposition")) };
  }
  throw failure(response, path, await response.json().catch(() => null));
}

/** The error for a failed response whose body (JSON, if any) is `data`. */
function failure(response: Response, path: string, data: unknown): ApiError {
  const error = isErrorBody(data) ? data.error : null;
  if (!error) {
    // The dev proxy answers 502/504 with no JSON when the backend is down.
    if (response.status === 502 || response.status === 503 || response.status === 504) return unreachable();
    return new ApiError(response.status, "http_error", `The server answered ${response.status}.`);
  }
  if (response.status === 401 && !path.startsWith("/auth/")) onSignedOut?.();
  return new ApiError(response.status, error.code, error.message, error.details);
}

/** The file name in a Content-Disposition header: the UTF-8 one if given (RFC 5987), else the plain one. */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!.trim());
    } catch {
      // Malformed: fall back to the plain name.
    }
  }
  return disposition.match(/filename="([^"]*)"/i)?.[1] ?? null;
}

function unreachable() {
  return new ApiError(0, UNREACHABLE, "Can't reach the Nestboard server. Is it running?");
}

function isErrorBody(data: unknown): data is { error: { code: string; message: string; details?: unknown } } {
  if (typeof data !== "object" || data === null || !("error" in data)) return false;
  const error = (data as { error: unknown }).error;
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}
