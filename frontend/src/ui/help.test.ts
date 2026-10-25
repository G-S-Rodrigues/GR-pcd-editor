import { afterAll, expect, test } from "vitest";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildHelp } from "./help";
import { KEY_DOCS, MOUSE_DOCS } from "./keys";
import { bindPopovers } from "./popover";

const dom = installFakeDom();
afterAll(() => dom.restore());
const mk = (tag: string, id: string) => {
  const e = dom.root.constructor === undefined ? null : (new (dom.root.constructor as new (t: string) => FakeEl)(tag));
  e!.setAttribute("id", id);
  return e as FakeEl;
};

test("UI-1141 the Keyboard help fills its table from the one key table, opens and closes through the popover manager, and closes only its own entry", () => {
  const helpPanel = mk("div", "help-overlay");
  const helpAnchor = mk("button", "help");
  const displayPanel = mk("div", "display-pop");
  const displayAnchor = mk("button", "display-open");
  const pops = bindPopovers(
    [
      { id: "display", anchor: displayAnchor as never, panel: displayPanel as never },
      { id: "help", anchor: helpAnchor as never, panel: helpPanel as never },
    ],
    { listenPointerDown: () => undefined, listenKey: () => undefined, listenResize: () => undefined, viewport: () => ({ w: 1000, h: 800 }), measure: () => ({ anchor: { left: 0, top: 0, width: 10, height: 10 }, size: { w: 100, h: 100 } }) },
  );
  const help = buildHelp(helpPanel as unknown as HTMLElement, pops);
  const rows = helpPanel.all().filter((e) => e.getAttribute("id") === "help-table")[0].children;
  expect(rows).toHaveLength(MOUSE_DOCS.length + KEY_DOCS.length);
  expect(help.isOpen()).toBe(false);
  help.apply("help");
  expect(help.isOpen()).toBe(true);
  expect(pops.openId()).toBe("help");
  expect(helpPanel.classList.contains("on")).toBe(true);
  help.apply("cancel");
  expect(help.isOpen()).toBe(false);
  expect(helpPanel.classList.contains("on")).toBe(false);
  pops.open("display");
  help.apply("cancel");
  help.apply(null);
  expect(pops.openId()).toBe("display");
  help.toggle();
  expect(pops.openId()).toBe("help");
  help.toggle();
  expect(pops.isOpen()).toBe(false);
});
