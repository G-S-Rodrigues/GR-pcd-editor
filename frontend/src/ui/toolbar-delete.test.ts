import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildToolbar } from "./toolbar";

const actions = { pickFile: () => undefined, preview: () => undefined, apply: () => undefined, undo: () => undefined, redo: () => undefined, saveSession: () => undefined, openExport: () => undefined };

test("UI-877 the toolbar Delete title keeps its long reason when blocked (regression guard, green before the note existed)", () => {
  const dom = installFakeDom();
  try {
    const store = createAppStore();
    buildToolbar(dom.root as unknown as HTMLElement, store, actions);
    store.set({ session: sessionFixture({ selection: { count: 5, ops: [] } }), candidate: candidateFixture(), compare: "original" });
    const del = dom.root.control("apply") as FakeEl;
    expect(del.disabled).toBe(true);
    expect(del.title).toContain("return to the edited view");
  } finally {
    dom.restore();
  }
});
