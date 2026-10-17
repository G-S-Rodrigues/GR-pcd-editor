import type { XhrLike } from "../upload";

/** Test double for XMLHttpRequest; not imported by application code. */
export class FakeXhr implements XhrLike {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = undefined;
  aborted = false;
  status = 0;
  responseText = "";
  upload: XhrLike["upload"] = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.body = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }
  finishSending(): void {
    this.upload.onload?.();
  }
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
}
