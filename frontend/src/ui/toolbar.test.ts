import { beforeAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { buildToolbar } from "./toolbar";
import { TOOLTIPS } from "./tooltips";

const actions = { pickFile: () => undefined, preview: () => undefined, apply: () => undefined, undo: () => undefined, redo: () => undefined, saveSession: () => undefined, openExport: () => undefined };

let root: FakeEl;
let built: ReturnType<typeof buildToolbar>;
const store = createAppStore();
beforeAll(() => {
  root = installFakeDom().root; // one toolbar per file: control ids are registered once
  built = buildToolbar(root as unknown as HTMLElement, store, actions);
});
const byId = (id: string) => root.all().find((e) => e.attrs.get("id") === id);
const ctlOrder = (g: FakeEl) => g.all().filter((e) => e.attrs.has("data-control")).map((e) => e.attrs.get("data-control"));

test("UI-302 UI-303 the file and history buttons are icons with their ids and names; Preview stays text and Apply is the red Delete (trash icon plus the word); disabled adds the reason", () => {
  for (const id of ["open-file", "save-session", "export", "undo", "redo"]) {
    const b = root.control(id) as FakeEl;
    expect(b, id).toBeDefined();
    expect(b.children.map((c) => c.tag), id).toEqual(["svg"]);
    expect(b.text(), id).toBe("");
    expect(b.getAttribute("aria-label"), id).toBe(describeControls().find((c) => c.id === id)?.label);
  }
  expect(root.control("preview")?.children.map((c) => c.tag)).toEqual(["#text"]);
  expect(root.control("apply")?.children.map((c) => c.tag)).toEqual(["svg", "#text"]); // trash icon plus the word Delete
  // UI-303: disabled without a file, the reason is appended to the tooltip of an icon button
  store.set({ session: null });
  expect(root.control("save-session")?.title).toBe(`${TOOLTIPS["save-session"]} (no file open)`);
  store.set({ session: sessionFixture() });
  expect(root.control("save-session")?.title).toBe(TOOLTIPS["save-session"]);
  expect(root.control("save-session")?.disabled).toBe(false);
});

test("UI-1135 the top bar has a left, a centre and a right group in order; the right anchors are icon buttons; no headline spans remain", () => {
  const groups = root.all().filter((e) => e.classList.contains("grp"));
  expect(groups.map((g) => ["left", "centre", "right"].find((c) => g.classList.contains(c)))).toEqual(["left", "centre", "right"]);
  const [left, centre, right] = groups;
  expect(ctlOrder(left)).toEqual(["open-file", "save-session", "export", "undo", "redo"]);
  expect(left.all().filter((e) => e.classList.contains("tsep")).length).toBe(1);
  expect(ctlOrder(right)).toEqual(["display-open", "details-open", "help", "preview", "apply"]);
  expect(right.all().filter((e) => e.classList.contains("tsep")).length).toBe(1);
  expect(byId("kept-chip")).toBeDefined();
  expect(right.contains(byId("kept-chip"))).toBe(true);
  expect(centre.children.length).toBe(0); // the data mode is built into it by main.ts
  for (const [id, icon] of [["display-open", "sliders"], ["details-open", "info"], ["help", "keyboard"]] as const) {
    const b = root.control(id) as FakeEl;
    expect(b.children.map((c) => c.tag), id).toEqual(["svg"]);
    expect(b.children[0].getAttribute("data-icon"), id).toBe(icon);
    expect(b.text(), id).toBe("");
    expect(b.getAttribute("aria-label"), id).toBe(describeControls().find((c) => c.id === id)?.label);
  }
  expect(byId("headline-delete")).toBeUndefined();
  expect(byId("headline-kept")).toBeUndefined();
  expect(built.centre).toBe(centre);
  expect(Object.keys(built.anchors)).toEqual(["display", "details", "help"]);
  expect(built.anchors.display).toBe(root.control("display-open"));
});

test("UI-1136 the document title shows the file name and the Edited subtitle follows the unsaved flag", () => {
  store.set({ session: null });
  const title = byId("doc-title")!;
  const badge = byId("unsaved-badge")!;
  expect(title.text()).toBe("No file open");
  expect(badge.hidden).toBe(true);
  expect(badge.title).toBe("No unsaved edits");
  store.set({ session: sessionFixture({ filename: "room.pcd" }) });
  expect(title.text()).toBe("room.pcd");
  expect(title.title).toBe("room.pcd");
  expect(badge.hidden).toBe(true);
  store.set({ session: sessionFixture({ filename: "room.pcd", unsaved: true }) });
  expect(badge.hidden).toBe(false);
  expect(badge.text()).toBe("Edited");
  expect(badge.title).toBe("Unsaved edits");
  expect(badge.children[0].classList.contains("dot")).toBe(true);
});

test("UI-1134 the Delete button reads Delete N and the kept chip N kept from the current candidate", () => {
  const apply = root.control("apply") as FakeEl;
  const chip = byId("kept-chip")!;
  store.set({ session: sessionFixture(), candidate: null });
  expect(apply.text().trim()).toBe("Delete");
  expect(chip.hidden).toBe(true);
  expect(chip.title).toBe("Kept by protection —");
  store.set({ session: sessionFixture(), candidate: candidateFixture({ candidates: 1234, protected_retained: 5 }) });
  expect(apply.text().trim()).toBe("Delete 1,234");
  expect(chip.hidden).toBe(false);
  expect(chip.text()).toBe("5 kept");
  expect(chip.title).toBe("Kept by protection 5");
  store.set({ session: sessionFixture(), candidate: candidateFixture({ candidates: 3, protected_retained: 0 }) });
  expect(chip.hidden).toBe(true);
  expect(chip.title).toBe("Kept by protection 0");
});
