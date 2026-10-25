import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { describeControls } from "./describe";
import { FIELD_SPECS } from "./fields";
import { MOUSE_DOCS } from "./keys";
import { INDEX_HTML } from "../testing/tokens";
import { type PanelActions, buildEditPanels } from "./panels";
import { TOOLTIPS } from "./tooltips";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const protectionEdit = vi.fn(() => ({ ok: true as const, model: store.get().tools.protection }));
const actions = new Proxy({ protectionEdit } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions, { toolRoot: dom.root as unknown as HTMLElement, scroller: { scrollTop: 0 } });
/** The eye / eyeoff state icon sits beside the switch in `.band-state`: the switch itself holds no content (M3). */
const stateHolder = () => dom.root.all().find((e) => e.classList.contains("band-state"))!;
const ctl = (id: string) => dom.root.control(id) as FakeEl;
beforeEach(() => {
  protectionEdit.mockClear();
  store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "none" });
});

test("UI-1070 the Show band switch: a content-free role switch named by aria-label, with the eye icon beside it (eyeoff when off), tooltip, aria state following bandVisible; a click flips bandVisible and touches no protection", () => {
  const sw = ctl("prot-show-band");
  expect(sw, "#prot-show-band is built").toBeTruthy();
  expect(sw.tag).toBe("button");
  expect(sw.getAttribute("role")).toBe("switch");
  expect(sw.getAttribute("aria-label")).toBe("Show band");
  expect(sw.children, "the switch holds no icon and no text, so nothing can overflow its 36 px track").toHaveLength(0);
  expect(sw.text()).toBe("");
  expect(sw.title).toBe("Show band on canvas");
  expect(TOOLTIPS["prot-show-band"]).toBe("Show band on canvas");
  expect(FIELD_SPECS.find((f) => f.id === "prot-show-band")).toMatchObject({ label: "Show band", group: "protection" });
  expect(describeControls().find((d) => d.id === "prot-show-band")).toMatchObject({ label: "Show band", group: "protection" });
  expect(store.get().bandVisible).toBe(true);
  expect(sw.getAttribute("aria-checked")).toBe("true");
  expect(sw.getAttribute("aria-pressed"), "a role=switch carries aria-checked only").toBeNull();
  expect(stateHolder().children[0].getAttribute("data-icon")).toBe("eye");
  const before = store.get().tools.protection;
  sw.fire("click");
  expect(store.get().bandVisible).toBe(false);
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(sw.getAttribute("aria-pressed")).toBeNull();
  expect(stateHolder().children[0].getAttribute("data-icon")).toBe("eyeoff");
  expect(protectionEdit).not.toHaveBeenCalled();
  expect(store.get().tools.protection).toBe(before);
  sw.fire("click");
  expect(store.get().bandVisible).toBe(true);
  expect(stateHolder().children[0].getAttribute("data-icon")).toBe("eye");
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

test("UI-1075 the Show band icon is rebuilt only when bandVisible changes, not on other store updates", () => {
  const icon = stateHolder().children[0];
  store.update((s) => ({ ...s, previewLive: !s.previewLive }));
  store.update((s) => ({ ...s, previewLive: !s.previewLive }));
  expect(stateHolder().children[0], "the same icon node after unrelated updates").toBe(icon);
  store.update((s) => ({ ...s, bandVisible: false }));
  expect(stateHolder().children[0]).not.toBe(icon);
  expect(stateHolder().children[0].getAttribute("data-icon")).toBe("eyeoff");
  const off = stateHolder().children[0];
  store.update((s) => ({ ...s, previewLive: !s.previewLive }));
  expect(stateHolder().children[0]).toBe(off);
});

test("UI-1243 the Show band switch has no content and a state icon beside it; the I-understand row is a left-aligned checkbox row that [hidden] really hides (the .f flex rule must not beat it)", () => {
  const css = [...INDEX_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  expect(rules.find((r) => r.selector === ".f[hidden]")?.body ?? "", ".f[hidden] rule").toMatch(/display:\s*none/);
  expect(rules.find((r) => r.selector === ".f.chk")?.body ?? "", ".f.chk rule").toMatch(/justify-content:\s*flex-start/);
  expect(rules.find((r) => r.selector === ".band-ctl")?.body ?? "", ".band-ctl rule").toMatch(/display:\s*flex/);
  const row = dom.root.all().find((e) => e.classList.contains("f") && e.children.includes(ctl("prot-ack")))!;
  expect(row, "the prot-ack row").toBeTruthy();
  expect(row.classList.contains("chk"), "a plain checkbox row is left-aligned").toBe(true);
  expect(row.children[0], "box first, text after it").toBe(ctl("prot-ack"));
  expect(row.hidden, "Use global: no acknowledgment").toBe(true);
  store.update((s) => ({ ...s, tools: { ...s.tools, protection: { ...s.tools.protection, mode: "override" } } }));
  expect(row.hidden, "Override: the acknowledgment shows").toBe(false);
});
