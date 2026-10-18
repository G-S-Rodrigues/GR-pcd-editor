import { expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildViewbar } from "./viewbar";

const actions = { size: () => ({ w: 100, h: 100 }), refresh: () => undefined, toggleHelp: () => undefined, notify: () => undefined, setCompare: () => undefined, holdPress: () => undefined, holdRelease: () => undefined };

test("UI-302 the help lamp is an icon button that keeps its id and name", () => {
  const dom = installFakeDom();
  try {
    buildViewbar(dom.root as unknown as HTMLElement, createAppStore(), actions);
    const b = dom.root.control("help") as FakeEl;
    expect(b.children.map((c) => c.tag)).toEqual(["svg"]);
    expect(b.getAttribute("aria-label")).toBe("Controls help");
    expect(b.text()).toBe("");
  } finally {
    dom.restore();
  }
});
