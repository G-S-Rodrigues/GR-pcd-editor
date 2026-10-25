import { afterAll, beforeAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { RESERVED } from "../filterboxes/placement";
import { CLUSTER, CUBE, CUBE_RIGHT, CUBE_SIDE, CUBE_STAGE, CUBE_TOP, CUBE_NAV, CUBE_WRAP, CUBE_WRAP_TOP, STACK } from "../view/layout";
import { cubeNavCss } from "./cube-arrows";
import { togglePerspective } from "../view/camera";
import { buildCameraCluster } from "./camera-cluster";
import { describeControls } from "./describe";
import { classifyKey } from "./keys";
import { TOOLTIPS } from "./tooltips";

let dom: ReturnType<typeof installFakeDom>;
let root: FakeEl;
const store = createAppStore();
const icon = (id: string) => root.control(id)?.children[0]?.getAttribute("data-icon");

beforeAll(() => {
  dom = installFakeDom();
  root = dom.root;
  buildCameraCluster(root as unknown as HTMLElement, store, { size: () => ({ w: 800, h: 600 }) });
});
afterAll(() => dom.restore());

test("UI-1232 22-8 the camera cluster is a vertical stack under the ViewCube, centred on it, in the same order, and the cube moves to the top", () => {
  expect(root.style.flexDirection).toBe("column");
  expect(root.style.right).toBe(`${CUBE_RIGHT + (CUBE_WRAP - CLUSTER.w) / 2}px`);
  expect(root.style.top).toBe(`${CUBE_TOP + CUBE_WRAP + CLUSTER.gap}px`);
  expect([CLUSTER.w, CLUSTER.h]).toEqual([STACK.w, STACK.h]);
  expect(root.style.width).toBe(`${STACK.w}px`);
  expect(root.style.height).toBe(`${STACK.h}px`);
  expect(root.children.map((c) => c.getAttribute("data-control"))).toEqual(["view-perspective", "fit-cloud", "pivot-reset", "pivot-pick"]);
  expect(cubeNavCss()).toContain(`#viewcube { position: absolute; right: ${CUBE_RIGHT}px; top: ${CUBE_TOP}px;`);
});

test("UI-320 the cluster holds projection, fit, reset pivot and pick pivot in that order, each an icon button", () => {
  const ids = root.children.map((c) => c.getAttribute("data-control"));
  expect(ids).toEqual(["view-perspective", "fit-cloud", "pivot-reset", "pivot-pick"]);
  expect([icon("view-perspective"), icon("fit-cloud"), icon("pivot-reset"), icon("pivot-pick")]).toEqual(["persp", "fit", "rpiv", "ppiv"]);
  for (const c of root.children) {
    expect(c.text()).toBe("");
    expect(c.getAttribute("aria-label")).toBe(describeControls().find((d) => d.id === c.getAttribute("data-control"))?.label);
  }
});

test("UI-324 all four are disabled without a file and enabled with one", () => {
  for (const c of root.children) expect(c.disabled, c.getAttribute("data-control") ?? "").toBe(true);
  store.set({ session: sessionFixture() });
  for (const c of root.children) expect(c.disabled, c.getAttribute("data-control") ?? "").toBe(false);
});

test("UI-321 the projection icon and aria-pressed follow camera.ortho (pressed = perspective on)", () => {
  const b = root.control("view-perspective") as FakeEl;
  const was = store.get().camera.ortho;
  expect([icon("view-perspective"), b.getAttribute("aria-pressed")]).toEqual(was ? ["ortho", "false"] : ["persp", "true"]);
  store.set({ camera: togglePerspective(store.get().camera) });
  expect([icon("view-perspective"), b.getAttribute("aria-pressed")]).toEqual(was ? ["persp", "true"] : ["ortho", "false"]);
  b.fire("click");
  expect(store.get().camera.ortho).toBe(was);
});

test("UI-322 pick pivot is pressed while armed, a second click disarms, and Esc is the cancel key", () => {
  const b = root.control("pivot-pick") as FakeEl;
  expect(b.getAttribute("aria-pressed")).toBe("false");
  b.fire("click");
  expect(store.get().interaction).toBe("pick-pivot");
  expect(b.getAttribute("aria-pressed")).toBe("true");
  b.fire("click");
  expect(store.get().interaction).toBe("orbit");
  expect(b.getAttribute("aria-pressed")).toBe("false");
  expect(classifyKey({ key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: "BODY" })).toBe("cancel");
});

test("UI-323 the typed pivot fields and Set pivot are gone", () => {
  const gone = ["pivot-x", "pivot-y", "pivot-z", "pivot-set"];
  expect(describeControls().map((c) => c.id).filter((id) => gone.includes(id))).toEqual([]);
  expect(Object.keys(TOOLTIPS).filter((id) => gone.includes(id))).toEqual([]);
});

test("UI-326 the reserved top-right rectangle is the ViewCube with the camera stack under it, derived from the shared constants", () => {
  expect(CUBE.h).toBeGreaterThanOrEqual(CUBE_TOP + CUBE_WRAP + CLUSTER.gap + CLUSTER.h);
  expect(CUBE.w).toBeGreaterThanOrEqual(CLUSTER.w);
  const [, r] = RESERVED({ w: 780, h: 560 });
  expect(r).toEqual({ l: 780 - CUBE.w, t: 0, r: 780, b: CUBE.h });
});

test("UI-710 the camera stack sits under the ViewCube wrapper (the cube is at the top) and the reserved rectangle follows it", () => {
  const top = Number.parseFloat(root.style.top);
  expect(CUBE_WRAP_TOP + CUBE_WRAP + CLUSTER.gap).toBeLessThanOrEqual(top);
  expect(CUBE_WRAP_TOP).toBe(CUBE_TOP);
  expect(CUBE.h).toBe(CUBE_TOP + CUBE_WRAP + CLUSTER.gap + STACK.h + 8); // 22-8: the column reserves the stack under the cube (it covers the row above it too)
  expect(CUBE_WRAP).toBeGreaterThanOrEqual(2 * CUBE_NAV.ring + CUBE_NAV.arrow);
  expect(CLUSTER.w).toBeLessThanOrEqual(CUBE_WRAP);
  expect(CUBE_SIDE).toBeLessThanOrEqual(40);
  expect(CUBE_STAGE).toBeLessThanOrEqual(80);
  expect(CUBE_RIGHT).toBe(8);
});

test("UI-711 the cube stage and face sizes come from the constants in one stylesheet, not from index.html", () => {
  const css = cubeNavCss();
  expect(css).toContain(`.cube-stage { left: ${(CUBE_WRAP - CUBE_STAGE) / 2}px; top: ${(CUBE_WRAP - CUBE_STAGE) / 2}px; width: ${CUBE_STAGE}px; height: ${CUBE_STAGE}px;`);
  expect(css).toContain(`.cube-face { left: ${(CUBE_STAGE - CUBE_SIDE) / 2}px; top: ${(CUBE_STAGE - CUBE_SIDE) / 2}px; width: ${CUBE_SIDE}px; height: ${CUBE_SIDE}px;`);
  expect(css).toContain(`top: ${CUBE_WRAP_TOP}px`);
});
