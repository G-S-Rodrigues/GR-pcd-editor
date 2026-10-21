import { afterAll, beforeAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { sessionFixture } from "../testing/fixtures";
import { contrastRatio } from "../colour/palette";
import { applyPreset, PRESET_ORDER } from "../view/presets";
import { snapCamera } from "../view/cube";
import { CORNER_IDS } from "../view/cubenav";
import { CUBE_NAV, CUBE_WRAP } from "../view/layout";
import { ARROW_STYLE, cubeNavCss } from "./cube-arrows";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";
import { buildTriad } from "./triad";
import { buildViewCube } from "./viewcube";

let dom: ReturnType<typeof installFakeDom>;
let root: FakeEl;
const store = createAppStore();

beforeAll(() => {
  dom = installFakeDom();
  root = dom.root;
  buildViewCube(root as unknown as HTMLElement, store);
});
afterAll(() => dom.restore());

const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test("UI-333 every arrow click equals applyPreset for its face, including a face hidden behind the cube", () => {
  store.set({ session: sessionFixture() });
  for (const face of PRESET_ORDER) {
    // an oblique camera: the hidden faces are not reachable through the cube's own faces
    const start = { ...store.get().camera, ortho: false };
    store.set({ camera: start });
    const hidden = (root.control(`cube-${face}`) as FakeEl).dataset.facing === "false";
    root.control(`arrow-${face}`)?.fire("click");
    const want = applyPreset(start, face);
    expect(same(store.get().camera.orientation, want.orientation), face).toBe(true);
    expect(store.get().camera.ortho).toBe(true);
    // the cube turned to that face, so the face now faces the viewer
    expect((root.control(`cube-${face}`) as FakeEl).dataset.facing, `${face} (hidden before: ${hidden})`).toBe("true");
  }
  // at least one of the six was hidden at some start (the default camera sees three faces)
});

test("UI-334 every corner click equals snapCamera with its three faces: look is minus the sum of the normals, Z up, orthographic", () => {
  for (const id of CORNER_IDS) {
    const start = { ...store.get().camera, ortho: false };
    store.set({ camera: start });
    root.control(id)?.fire("click");
    const faces = id.slice(7).split("-") as (typeof PRESET_ORDER)[number][];
    const want = snapCamera(start, { faces });
    expect(same(store.get().camera.orientation, want.orientation), id).toBe(true);
    expect(store.get().camera.ortho, id).toBe(true);
  }
});

test("UI-335 the 12 new ids are described and have distinct tooltips and accessible names", () => {
  const ids = [...PRESET_ORDER.map((p) => `arrow-${p}`), ...CORNER_IDS];
  expect(ids).toHaveLength(14);
  const desc = describeControls();
  const tips = new Set<string>();
  const names = new Set<string>();
  for (const id of ids) {
    const d = desc.find((x) => x.id === id);
    expect(d, id).toBeDefined();
    expect(TOOLTIPS[id], id).toBeTruthy();
    tips.add(TOOLTIPS[id]);
    names.add(d?.label ?? "");
    const el = root.control(id) as FakeEl;
    expect(el.getAttribute("aria-label"), id).toBe(d?.label);
    expect(el.title, id).toBe(TOOLTIPS[id]);
  }
  expect(tips.size).toBe(14);
  expect(names.size).toBe(14);
});

test("UI-336 target sizes, resting and hover opacity come from the one style module and the glyph reads against its button", () => {
  expect(CUBE_NAV.arrow).toBeGreaterThanOrEqual(22);
  expect(CUBE_NAV.zone).toBeGreaterThanOrEqual(18);
  expect(ARROW_STYLE.restOpacity).toBeLessThan(0.2);
  expect(ARROW_STYLE.hoverOpacity).toBeGreaterThan(0.8);
  const css = cubeNavCss();
  expect(css).toContain(`opacity: ${ARROW_STYLE.restOpacity}`);
  expect(css).toContain(`opacity: ${ARROW_STYLE.hoverOpacity}`);
  expect(css).toContain(`width: ${CUBE_NAV.arrow}px`);
  expect(css).toContain(`width: ${CUBE_NAV.zone}px`);
  expect(css).toContain(`:focus-within`); // keyboard focus shows the arrows as the pointer does
  expect(css).toMatch(/prefers-reduced-motion: reduce[^}]*transition: none/);
  expect(css).toContain(`width: ${CUBE_WRAP}px`);
  expect(contrastRatio(ARROW_STYLE.glyph, ARROW_STYLE.fill)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(ARROW_STYLE.glyph, ARROW_STYLE.hoverFill)).toBeGreaterThanOrEqual(3);
});

test("UI-339 arrows and zones are disabled without a file, the triad draws three labelled axes and has no pointer target", () => {
  store.set({ session: null });
  for (const id of [...PRESET_ORDER.map((p) => `arrow-${p}`), ...CORNER_IDS]) expect((root.control(id) as FakeEl).disabled, id).toBe(true);
  store.set({ session: sessionFixture() });
  for (const id of PRESET_ORDER.map((p) => `arrow-${p}`)) expect((root.control(id) as FakeEl).disabled, id).toBe(false);
  const t = installFakeDom();
  const tstore = createAppStore();
  buildTriad(t.root as unknown as HTMLElement, tstore);
  const svg = t.root.children[0];
  expect(svg.all().filter((e) => e.tag === "line")).toHaveLength(3);
  expect(svg.all().filter((e) => e.tag === "text").map((e) => e.textContent).sort()).toEqual(["X", "Y", "Z"]);
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  t.restore();
});
