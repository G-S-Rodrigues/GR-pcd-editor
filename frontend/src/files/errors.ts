/** Error carrying the server's `{"error":{code,message}}` contract. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorFromBody(status: number, text: string): ApiError {
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    const e = body.error;
    if (e && typeof e.code === "string") {
      return new ApiError(status, e.code, typeof e.message === "string" ? e.message : e.code);
    }
  } catch {
    // not JSON: fall through
  }
  return new ApiError(status, `http_${status}`, `request failed with status ${status}`);
}

export async function parseError(res: Response): Promise<ApiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // unreadable body: generic error below
  }
  return errorFromBody(res.status, text);
}

export function networkError(cause: unknown): ApiError {
  const detail = cause instanceof Error ? `: ${cause.message}` : "";
  return new ApiError(0, "network", `could not reach the app${detail}`);
}

/** The toast for a file that could not be opened: its name, the reason, what to check. */
export const openErrorText = (name: string, reason: string): string =>
  `Cannot open ${name}: ${reason.replace(/[.\s]+$/, "")}. Is it a valid PCD (or .pcdsession)?`;
