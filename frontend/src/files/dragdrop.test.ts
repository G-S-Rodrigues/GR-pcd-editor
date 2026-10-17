import { expect, test } from "vitest";
import { attachDropZone, pickDroppedFile, type DropEventLike } from "./dragdrop";

const f = (name: string) => ({ name }) as unknown as File;
const dt = (files: File[], dir = false) => ({
  files,
  items: files.map(() => ({ webkitGetAsEntry: () => ({ isDirectory: dir }) })),
});

test("FE-F-20 a single .pcd is accepted", () => {
  const file = f("a.PCD");
  expect(pickDroppedFile(dt([file]))).toEqual({ file });
});

test("FE-F-21 a .pcdsession is accepted", () => {
  const file = f("a.pcdsession");
  expect(pickDroppedFile(dt([file]))).toEqual({ file });
});

test("FE-F-22 several files are refused", () => {
  expect(pickDroppedFile(dt([f("a.pcd"), f("b.pcd")]))).toEqual({ error: "multiple_files" });
});

test("FE-F-23 a directory is refused", () => {
  expect(pickDroppedFile(dt([f("folder")], true))).toEqual({ error: "directory_not_supported" });
});

test("FE-F-24 other extensions are refused", () => {
  expect(pickDroppedFile(dt([f("a.txt")]))).toEqual({ error: "unsupported_type" });
  expect(pickDroppedFile(dt([]))).toEqual({ error: "no_files" });
});

test("drop zone prevents defaults, tracks hover depth and reports drops", () => {
  const listeners = new Map<string, (e: DropEventLike) => void>();
  const el = {
    addEventListener: (t: string, fn: (e: DropEventLike) => void) => listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
  };
  const hover: boolean[] = [];
  const got: unknown[] = [];
  const detach = attachDropZone(el, {
    onFile: (x) => got.push(x),
    onError: (c) => got.push(c),
    onHover: (h) => hover.push(h),
  });
  let prevented = 0;
  const ev = (d?: ReturnType<typeof dt>): DropEventLike => ({
    preventDefault: () => (prevented += 1),
    dataTransfer: d,
  });
  listeners.get("dragenter")!(ev());
  listeners.get("dragenter")!(ev());
  listeners.get("dragleave")!(ev());
  listeners.get("dragover")!(ev());
  expect(hover).toEqual([true, true]);
  listeners.get("dragleave")!(ev());
  expect(hover).toEqual([true, true, false]);
  const file = f("a.pcd");
  listeners.get("drop")!(ev(dt([file])));
  listeners.get("drop")!(ev(dt([f("x.txt")])));
  expect(got).toEqual([file, "unsupported_type"]);
  expect(prevented).toBe(5) // enter x2, over, drop x2;
  detach();
  expect(listeners.size).toBe(0);
});
