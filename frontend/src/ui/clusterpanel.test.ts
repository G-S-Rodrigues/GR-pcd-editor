import { afterAll, beforeEach, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { type PanelActions, buildEditPanels } from "./panels";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const actions = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (() => undefined) }) as unknown as PanelActions;
buildEditPanels(dom.root as unknown as HTMLElement, store, actions);
const byId = (id: string) => dom.root.all().find((e) => e.getAttribute("id") === id) as FakeEl;
beforeEach(() => store.set({ ...createAppStore().get(), session: sessionFixture(), tool: "cluster" }));

const cl = (seed: number, size: number) => ({ seed_id: seed, radius: 1.1, size, complete: true, limit: null, bounds: { min: [0, 0, 0], max: [1, 1, 1] } });

test("UI-874 #cluster-result shows the pending preview's seed, not the committed candidate's", () => {
  store.update((s) => ({
    ...s,
    candidate: candidateFixture({ candidates: 217, cluster: cl(34798, 217) }),
    preview: { id: "p", op: "add", selected_after: 417, base_selected: 217, added: 200, removed: 0, cluster: cl(70501, 200) },
  }));
  const text = byId("cluster-result").text();
  expect(text).toContain("70501");
  expect(text).not.toContain("34798");
  expect(text).toContain("Preview, not committed");
  store.update((s) => ({ ...s, preview: null }));
  expect(byId("cluster-result").text()).toContain("34798");
});
