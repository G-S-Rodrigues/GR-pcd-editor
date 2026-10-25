import { afterAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { modeIndicator } from "../status/model";
import { buildStatusbar } from "./statusbar";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const mode = new (dom.root.constructor as new (t: string) => FakeEl)("div");
let opened = 0;
buildStatusbar(dom.root as unknown as HTMLElement, mode as unknown as HTMLElement, store, { openDetails: () => void opened++ });

test("UI-1139 the footer renders the footer items, the Invalid value opens Cloud details, and the mode line carries its text and title", () => {
  expect(dom.root.text()).toBe("No file open");
  store.set({ session: sessionFixture({ counts: { ...sessionFixture().counts, invalid_total: 5, invalid_active: 2 } }) });
  const items = dom.root.children.filter((c) => c.getAttribute("data-status") !== null);
  expect(items.map((i) => i.getAttribute("data-status"))).toEqual(["Displayed", "Selected", "Protected", "Candidates", "Invalid (active/total)", "Deleted", "Rendered", "Job"]);
  expect(items.map((i) => i.className)).toEqual(items.map(() => "item"));
  const inv = items[4];
  const btn = inv.all().find((e) => e.tag === "button") as FakeEl;
  expect(btn.getAttribute("data-control")).toBe("status-invalid");
  expect(btn.text()).toBe("2 / 5");
  store.set({ session: sessionFixture({ counts: { ...sessionFixture().counts, invalid_total: 5, invalid_active: 1 } }) }); // a second render keeps one registered button
  const again = dom.root.all().find((e) => e.tag === "button") as FakeEl;
  expect(again.text()).toBe("1 / 5");
  expect(again).toBe(btn);
  btn.fire("click");
  expect(opened).toBe(1);
  expect(items[0].all().some((e) => e.tag === "button")).toBe(false);
  expect(mode.textContent).toBe(modeIndicator(store.get()));
  expect(mode.title).toBe(modeIndicator(store.get()));
});
