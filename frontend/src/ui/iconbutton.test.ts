import { expect, test } from "vitest";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { iconControl } from "./iconbutton";
import { TOOLTIPS } from "./tooltips";

test("UI-301 iconControl: aria-label is the describe label, svg hidden, tooltip from TOOLTIPS, id kept", () => {
  const dom = installFakeDom();
  try {
    let clicked = 0;
    const b = iconControl("undo", "undo", { onclick: () => clicked++ }) as unknown as FakeEl;
    const label = describeControls().find((c) => c.id === "undo")?.label;
    expect(label).toBe("Undo");
    expect(b.getAttribute("aria-label")).toBe(label);
    expect(b.getAttribute("data-control")).toBe("undo");
    expect(b.title).toBe(TOOLTIPS.undo);
    expect(b.className).toContain("ib");
    expect(b.children).toHaveLength(1);
    expect(b.children[0].tag).toBe("svg");
    expect(b.children[0].getAttribute("aria-hidden")).toBe("true");
    expect(b.text()).toBe("");
    b.fire("click");
    expect(clicked).toBe(1);
  } finally {
    dom.restore();
  }
});

test("UI-304 the six icon-button labels are unchanged and their tooltips distinct (guard, passes before the change)", () => {
  const want: Record<string, string> = {
    "open-file": "Open from this computer",
    "save-session": "Save session",
    export: "Export",
    undo: "Undo",
    redo: "Redo",
    help: "Controls help",
  };
  const d = describeControls();
  for (const [id, label] of Object.entries(want)) expect(d.find((c) => c.id === id)?.label, id).toBe(label);
  expect(new Set(Object.keys(want).map((id) => TOOLTIPS[id])).size).toBe(6);
});
