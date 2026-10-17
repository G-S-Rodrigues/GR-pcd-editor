export type DropErrorCode =
  | "no_files"
  | "multiple_files"
  | "directory_not_supported"
  | "unsupported_type";

export type DropResult = { file: File } | { error: DropErrorCode };

export interface DataTransferLike {
  files: ArrayLike<File>;
  items?: ArrayLike<{ webkitGetAsEntry?: () => { isDirectory: boolean } | null }>;
}

const ACCEPTED = [".pcd", ".pcdsession"];

export function isAcceptedName(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED.some((ext) => lower.endsWith(ext));
}

export function pickDroppedFile(dt: DataTransferLike): DropResult {
  const count = Math.max(dt.files.length, dt.items?.length ?? 0);
  if (count === 0) return { error: "no_files" };
  if (count > 1) return { error: "multiple_files" };
  const entry = dt.items?.[0]?.webkitGetAsEntry?.();
  if (entry?.isDirectory) return { error: "directory_not_supported" };
  const file = dt.files[0];
  if (!file) return { error: "no_files" };
  if (!isAcceptedName(file.name)) return { error: "unsupported_type" };
  return { file };
}

export interface DropTarget {
  addEventListener(type: string, fn: (e: DropEventLike) => void): void;
  removeEventListener(type: string, fn: (e: DropEventLike) => void): void;
}

export interface DropEventLike {
  preventDefault(): void;
  dataTransfer?: DataTransferLike | null;
}

export interface DropHandlers {
  onFile: (file: File) => void;
  onError: (code: DropErrorCode) => void;
  onHover?: (hovering: boolean) => void;
}

/** Wires drag-and-drop on an element; returns a function that detaches. */
export function attachDropZone(el: DropTarget, h: DropHandlers): () => void {
  let depth = 0;
  const onEnter = (e: DropEventLike) => {
    e.preventDefault();
    depth += 1;
    h.onHover?.(true);
  };
  const onOver = (e: DropEventLike) => e.preventDefault();
  const onLeave = () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) h.onHover?.(false);
  };
  const onDrop = (e: DropEventLike) => {
    e.preventDefault();
    depth = 0;
    h.onHover?.(false);
    if (!e.dataTransfer) return h.onError("no_files");
    const res = pickDroppedFile(e.dataTransfer);
    if ("file" in res) h.onFile(res.file);
    else h.onError(res.error);
  };
  const handlers: [string, (e: DropEventLike) => void][] = [
    ["dragenter", onEnter],
    ["dragover", onOver],
    ["dragleave", onLeave],
    ["drop", onDrop],
  ];
  for (const [type, fn] of handlers) el.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of handlers) el.removeEventListener(type, fn);
  };
}
