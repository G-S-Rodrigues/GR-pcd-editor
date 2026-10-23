import { afterAll, beforeAll, expect, test } from "vitest";
import { setCompare } from "../compare/model";
import { type AppState, createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { KEY_DOCS, classifyKey } from "./keys";
import { TOOLTIPS } from "./tooltips";
import { buildToolbar } from "./toolbar";
import { buildDataMode } from "./viewbar";

const actions = { setCompare: () => undefined };
let dom: ReturnType<typeof installFakeDom>;
let root: FakeEl;
let topbar: FakeEl;
const store = createAppStore();

beforeAll(() => {
  dom = installFakeDom();
  root = dom.root;
  buildDataMode(root as unknown as HTMLElement, store, actions);
  // the help button moved to the top bar (22-5): its claim is checked on a toolbar built into a second root
  topbar = new (root.constructor as new (t: string) => FakeEl)("div");
  buildToolbar(topbar as unknown as HTMLElement, store, { pickFile: () => undefined, preview: () => undefined, apply: () => undefined, undo: () => undefined, redo: () => undefined, saveSession: () => undefined, openExport: () => undefined });
});
afterAll(() => dom.restore());

const modes = ["original", "edited", "overlay", "split"] as const;
const group = () => root.all().find((e) => e.attrs.get("role") === "group" && e.attrs.get("aria-label") === "Data mode");

test("UI-302 the help lamp is an icon button that keeps its id and name", () => {
  const b = topbar.control("help") as FakeEl;
  expect(b.children.map((c) => c.tag)).toEqual(["svg"]);
  expect(b.children[0].getAttribute("data-icon")).toBe("keyboard");
  expect(root.control("help")).toBeUndefined();
  expect(b.getAttribute("aria-label")).toBe("Controls help");
  expect(b.text()).toBe("");
});

test("UI-311 the data modes are a text segment group; each aria-pressed follows the compare mode and all are disabled without a file", () => {
  const g = group();
  expect(g, "role=group with aria-label Data mode").toBeDefined();
  const ids = modes.map((m) => `compare-${m}`);
  expect(g!.children.map((c) => c.getAttribute("data-control")).filter((x) => x && x.startsWith("compare-"))).toEqual(ids);
  for (const id of ids) {
    const b = root.control(id) as FakeEl;
    expect(b.children.map((c) => c.tag), id).toEqual(["#text"]);
    expect(b.text(), id).toBe(id.slice(8).replace(/^./, (c) => c.toUpperCase()));
    expect(b.disabled, id).toBe(true);
  }
  store.set({ session: sessionFixture() });
  for (const m of modes) {
    setCompare(store, m);
    for (const k of modes) {
      const b = root.control(`compare-${k}`) as FakeEl;
      expect(b.getAttribute("aria-pressed"), `${k} while ${m}`).toBe(k === m ? "true" : "false");
      expect(b.disabled).toBe(false);
    }
  }
});

test("UI-312 the overlay opacity slider is in the DOM only while Overlay is active; id and 0.05..1 range kept", () => {
  const present = () => root.all().some((e) => e.attrs.get("data-control") === "overlay-opacity");
  for (const m of modes) {
    setCompare(store, m);
    expect(present(), m).toBe(m === "overlay");
  }
  setCompare(store, "overlay");
  const slider = root.control("overlay-opacity") as FakeEl;
  expect(slider.getAttribute("min")).toBe("0.05");
  expect(slider.getAttribute("max")).toBe("1");
  expect(slider.getAttribute("aria-label")).toBe("Overlay opacity");
  slider.value = "9";
  slider.fire("input");
  expect((store.get() as AppState).overlayOpacity).toBe(1);
  slider.value = "0";
  slider.fire("input");
  expect((store.get() as AppState).overlayOpacity).toBe(0.05);
});

test("UI-313 Hold original is gone: no control, tooltip or key entry, and o is not a documented key", () => {
  expect(describeControls().map((c) => c.id)).not.toContain("compare-hold-original");
  expect(Object.keys(TOOLTIPS)).not.toContain("compare-hold-original");
  expect(KEY_DOCS.map((d) => d.id) as string[]).not.toContain("hold-original");
  expect(root.control("compare-hold-original")).toBeUndefined();
  expect(classifyKey({ key: "o", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: "BODY" })).toBeNull();
  expect(classifyKey({ key: "O", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, target: "BODY" })).toBeNull();
});
