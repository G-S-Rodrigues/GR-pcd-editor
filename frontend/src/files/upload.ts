import { ApiError, errorFromBody } from "./errors";
import { deleteJson } from "./http";

export type UploadPhase = "sending" | "importing";

export interface UploadOptions {
  replace?: boolean;
  onProgress?: (p: { loaded: number; total: number | null }) => void;
  onPhase?: (phase: UploadPhase) => void;
}

/** The slice of XMLHttpRequest the uploader uses (fakeable in tests). */
export interface XhrLike {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  upload: {
    onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
    onload: (() => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  responseText: string;
}

export interface UploadDeps {
  createXhr?: () => XhrLike;
  randomId?: () => string;
}

export interface UploadHandle<T> {
  uploadId: string;
  promise: Promise<T>;
  /** Cancels while bytes are being sent; false once import has begun. */
  cancel: () => boolean;
}

export function uploadFile<T = unknown>(
  file: File,
  opts: UploadOptions = {},
  deps: UploadDeps = {},
): UploadHandle<T> {
  const uploadId = (deps.randomId ?? (() => crypto.randomUUID().replaceAll("-", "")))();
  const xhr = (deps.createXhr ?? (() => new XMLHttpRequest() as unknown as XhrLike))();
  const query = new URLSearchParams({
    upload_id: uploadId,
    filename: file.name,
    replace: opts.replace ? "true" : "false",
  });
  let sending = true;

  const promise = new Promise<T>((resolve, reject) => {
    xhr.upload.onprogress = (e) => {
      opts.onProgress?.({ loaded: e.loaded, total: e.lengthComputable ? e.total : null });
    };
    xhr.upload.onload = () => {
      sending = false;
      opts.onPhase?.("importing");
    };
    xhr.onload = () => {
      sending = false;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new ApiError(xhr.status, "bad_response", "the app returned an unreadable reply"));
        }
      } else {
        reject(errorFromBody(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => {
      sending = false;
      reject(new ApiError(0, "network", "could not reach the app"));
    };
    xhr.onabort = () => {
      reject(new ApiError(0, "cancelled", "the upload was cancelled"));
    };
    xhr.open("POST", `/api/session/upload?${query.toString()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    opts.onPhase?.("sending");
    xhr.send(file);
  });

  const cancel = (): boolean => {
    if (!sending) return false;
    sending = false;
    xhr.abort();
    deleteJson(`/api/uploads/${uploadId}`).catch(() => undefined);
    return true;
  };
  return { uploadId, promise, cancel };
}
