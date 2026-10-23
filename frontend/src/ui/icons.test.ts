import { expect, test } from "vitest";
import { ICONS, ICON_NAMES, iconSvg } from "./icons";
import { installFakeDom } from "../testing/fakedom";

test("UI-300 ICONS holds the sheet names, every node is a path, circle or rect with attributes on a 24 grid", () => {
  expect([...ICON_NAMES].sort()).toEqual(
    ["open", "save", "exp", "undo", "redo", "orig", "edit", "ovl", "split", "persp", "ortho", "fit", "rpiv", "ppiv", "help", "chev", "arrow", "add", "sub", "int", "trash", "eye", "eyeoff", "pencil", "pick", "shield", "box", "sliders", "info", "keyboard", "list", "invalid", "poly", "cluster", "sparse", "plane", "thin", "rect", "level", "close", "chevr", "selectall", "invert", "clear"].sort(),
  );
  for (const name of ICON_NAMES) {
    expect(ICONS[name].length, name).toBeGreaterThan(0);
    for (const n of ICONS[name]) {
      expect(["path", "circle", "rect"], name).toContain(n.tag);
      expect(Object.keys(n.attrs).length, name).toBeGreaterThan(0);
      for (const v of Object.values(n.attrs)) expect(v.trim(), name).not.toBe("");
    }
  }
});

test("UI-300 iconSvg builds a hidden 24 grid svg that takes the text colour", () => {
  const dom = installFakeDom();
  try {
    const svg = iconSvg("undo") as unknown as import("../testing/fakedom").FakeEl;
    expect(svg.tag).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.children.length).toBe(ICONS.undo.length);
  } finally {
    dom.restore();
  }
});
