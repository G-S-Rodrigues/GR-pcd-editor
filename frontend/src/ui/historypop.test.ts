import { afterAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildHistoryPopover } from "./historypop";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
buildHistoryPopover(dom.root as unknown as HTMLElement, store);
const entry = (i: number, description: string, count: number) => ({ index: i, kind: "delete", description, count });

test("UI-1140 the History popover lists the steps with en-US counts and marks the undone ones, or says No edits yet", () => {
  expect(dom.root.all().find((e) => e.tag === "h4")?.text()).toBe("History");
  store.set({ session: sessionFixture() });
  expect(dom.root.text()).toContain("No edits yet");
  expect(dom.root.all().find((e) => e.getAttribute("id") === "history-list")?.children).toHaveLength(0);
  store.set({ session: sessionFixture({ history: { entries: [entry(0, "Delete box", 1234), entry(1, "Delete polygon", 5)], cursor: 1, can_undo: true, can_redo: true } }) });
  const rows = (dom.root.all().find((e) => e.getAttribute("id") === "history-list") as FakeEl).children;
  expect(rows.map((r) => r.text())).toEqual(["Delete box (1,234)", "Delete polygon (5) - undone"]);
  expect(rows.map((r) => r.className)).toEqual(["", "undone"]);
  expect(dom.root.text()).not.toContain("No edits yet");
});
