import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { buildToolbar } from "./toolbar";
import { TOOLTIPS } from "./tooltips";

const actions = { pickFile: () => undefined, preview: () => undefined, apply: () => undefined, undo: () => undefined, redo: () => undefined, saveSession: () => undefined, openExport: () => undefined };

test("UI-302 UI-303 the file and history buttons are icons with their ids and names; Preview and Apply stay text; disabled adds the reason", () => {
  const dom = installFakeDom();
  try {
    const store = createAppStore();
    const root = dom.root;
    buildToolbar(root as unknown as HTMLElement, store, actions);
    for (const id of ["open-file", "save-session", "export", "undo", "redo"]) {
      const b = root.control(id) as FakeEl;
      expect(b, id).toBeDefined();
      expect(b.children.map((c) => c.tag), id).toEqual(["svg"]);
      expect(b.text(), id).toBe("");
      expect(b.getAttribute("aria-label"), id).toBe(describeControls().find((c) => c.id === id)?.label);
    }
    for (const id of ["preview", "apply"]) expect(root.control(id)?.children.map((c) => c.tag), id).toEqual(["#text"]);
    // UI-303: disabled without a file, the reason is appended to the tooltip of an icon button
    expect(root.control("save-session")?.title).toBe(`${TOOLTIPS["save-session"]} (no file open)`);
    store.set({ session: sessionFixture() });
    expect(root.control("save-session")?.title).toBe(TOOLTIPS["save-session"]);
    expect(root.control("save-session")?.disabled).toBe(false);
  } finally {
    dom.restore();
  }
});
