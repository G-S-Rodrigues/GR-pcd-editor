import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { FIELD_SPECS } from "./fields";
import { MOUSE_DOCS } from "./keys";
import { type PanelActions, buildEditPanels } from "./panels";
import { TOOLTIPS } from "./tooltips";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const protectionEdit = vi.fn(() => ({ ok: true as const, model: store.get().tools.protection }));
const actions = new Proxy({ protectionEdit } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, { toolRoot: dom.root as unknown as HTMLElement, scroller: { scrollTop: 0 } });
const ctl = (id: string) => dom.root.control(id) as FakeEl;
beforeEach(() => {
  protectionEdit.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "none" });
});

test("UI-1070 the Show band switch: a role switch with the eye icon (eyeoff when off), tooltip, aria state following bandVisible; a click flips bandVisible and touches no protection", () => {
  const sw = ctl("prot-show-band");
  expect(sw, "#prot-show-band is built").toBeTruthy();
  expect(sw.tag).toBe("button");
  expect(sw.getAttribute("role")).toBe("switch");
  expect(sw.text()).toContain("Show band");
  expect(sw.title).toBe("Show band on canvas");
  expect(TOOLTIPS["prot-show-band"]).toBe("Show band on canvas");
  expect(FIELD_SPECS.find((f) => f.id === "prot-show-band")).toMatchObject({ label: "Show band", group: "protection" });
  expect(describeControls().find((d) => d.id === "prot-show-band")).toMatchObject({ label: "Show band", group: "protection" });
  expect(store.get().bandVisible).toBe(true);
  expect(sw.getAttribute("aria-checked")).toBe("true");
  expect(sw.getAttribute("aria-pressed")).toBe("true");
  expect(sw.children[0].getAttribute("data-icon")).toBe("eye");
  const before = store.get().tools.protection;
  sw.fire("click");
  expect(store.get().bandVisible).toBe(false);
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(sw.getAttribute("aria-pressed")).toBe("false");
  expect(sw.children[0].getAttribute("data-icon")).toBe("eyeoff");
  expect(protectionEdit).not.toHaveBeenCalled();
  expect(store.get().tools.protection).toBe(before);
  sw.fire("click");
  expect(store.get().bandVisible).toBe(true);
  expect(sw.children[0].getAttribute("data-icon")).toBe("eye");
});

test("UI-1073 the tilt fields' tooltips and the help row name the ring colours: red X ring and green Y ring", () => {
  const row = MOUSE_DOCS.find((d) => /tilt/i.test(d.label) && /ring/i.test(d.keys));
  expect(row, "the help overlay has a tilt-ring row").toBeDefined();
  expect(row!.keys).toContain("red X");
  expect(row!.keys).toContain("green Y");
  expect(row!.keys).not.toContain("blue");
  expect(row!.label).not.toContain("blue");
  expect(TOOLTIPS["prot-tilt-x"]).toContain("red X ring");
  expect(TOOLTIPS["prot-tilt-y"]).toContain("green Y ring");
  expect(TOOLTIPS["prot-tilt-x"]).not.toContain("blue");
  expect(TOOLTIPS["prot-tilt-y"]).not.toContain("blue");
});
