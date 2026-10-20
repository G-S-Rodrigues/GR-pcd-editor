import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createAppStore } from "../state/app";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { sessionFixture } from "../testing/fixtures";
import type { Layer } from "../state/types";
import { buildExportDialog } from "./export-dialog";
import { describeControls } from "./describe";
import { TOOLTIPS } from "./tooltips";

const layer = (over: Partial<Layer>): Layer => ({ id: 1, name: "Floor", colour: 0, visible: true, count: 30, bounds: null, ...over });
const withLayers = () =>
  sessionFixture({
    layers: [layer({}), layer({ id: 2, name: "Wall", visible: false, count: 20 })],
    counts: { ...sessionFixture().counts, main: 50, active: 100, invalid_active: 0 },
  });

const store = createAppStore();
const run = vi.fn(async () => undefined);
let dom: ReturnType<typeof installFakeDom>;
let dialog: ReturnType<typeof buildExportDialog>;
const el = (id: string) => all().find((e) => e.getAttribute("id") === id || e.getAttribute("data-control") === id) as FakeEl;
const all = () => dom.root.all();
const ticks = () => all().filter((e) => e.getAttribute("data-export-layer") !== null);

beforeAll(() => {
  dom = installFakeDom();
  (globalThis as { document: { body?: unknown } }).document.body = { append: (d: FakeEl) => dom.root.append(d) };
  dialog = buildExportDialog(store, run);
});
afterAll(() => dom.restore());
beforeEach(() => run.mockClear());

const pick = (id: string, on: boolean) => {
  const t = ticks().find((e) => e.getAttribute("data-export-layer") === id) as FakeEl;
  t.checked = on;
  t.fire("change");
};

test("UI-845 no picker for a layer-less session; with layers: Main first, all ticked, a hidden layer marked", () => {
  store.set({ session: sessionFixture() });
  dialog.open();
  expect(ticks()).toHaveLength(0);
  expect(el("export-layers").hidden).toBe(true);
  store.set({ session: withLayers() });
  dialog.open();
  expect(el("export-layers").hidden).toBe(false);
  expect(ticks().map((t) => t.getAttribute("data-export-layer"))).toEqual(["0", "1", "2"]);
  expect(ticks().every((t) => t.checked)).toBe(true);
  expect(el("export-layers").text()).toContain("Main (50)");
  expect(el("export-layers").text()).toContain("Wall (20) (hidden, still exported)");
});

test("UI-846 unticking the floor changes the exact count, and Export sends the strict subset", async () => {
  store.set({ session: withLayers() });
  dialog.open();
  expect(el("export-summary").text()).toContain("100");
  pick("1", false);
  expect(el("export-summary").text()).toContain("Exports 70 points from the chosen layers");
  el("export-go").fire("click");
  await Promise.resolve();
  expect(run).toHaveBeenCalledWith({ scope: "active", format: "binary", layers: [0, 2] });
});

test("UI-847 with everything ticked the request has no layers field; Export all re-ticks everything", async () => {
  store.set({ session: withLayers() });
  dialog.open();
  pick("2", false);
  el("export-all").fire("click");
  expect(ticks().every((t) => t.checked)).toBe(true);
  el("export-go").fire("click");
  await Promise.resolve();
  expect(run).toHaveBeenCalledWith({ scope: "active", format: "binary" });
});

test("UI-848 with nothing ticked Export is disabled and says why", () => {
  store.set({ session: withLayers() });
  dialog.open();
  for (const id of ["0", "1", "2"]) pick(id, false);
  expect(el("export-go").disabled).toBe(true);
  expect(el("export-go").title).toContain("Tick at least one layer to export");
});

test("UI-849 other scopes say the exact count comes after the export; the picker controls are described", () => {
  store.set({ session: withLayers() });
  dialog.open();
  pick("1", false);
  (el("export-scope") as unknown as { value: string }).value = "displayed";
  el("export-scope").fire("change");
  expect(el("export-summary").text()).toContain("within the chosen layers; the exact count is reported after the export");
  expect(describeControls().find((d) => d.id === "export-all")?.label).toBe("Export all layers");
  expect(TOOLTIPS["export-all"]).toBeTruthy();
});
