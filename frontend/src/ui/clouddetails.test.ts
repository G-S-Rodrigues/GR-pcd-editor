import { afterAll, expect, test } from "vitest";
import { createAppStore } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { type FakeEl, installFakeDom } from "../testing/fakedom";
import { buildCloudDetails } from "./inspector-shell";

const dom = installFakeDom();
afterAll(() => dom.restore());
const store = createAppStore();
const actions = { removeInvalid: () => undefined, removeInvalidVisible: () => store.get().session?.counts.invalid_active ? true : false, removeInvalidLabel: () => "Remove 3 invalid" };
buildCloudDetails(dom.root as unknown as HTMLElement, store, actions as never);
const all = () => dom.root.all();
const dl = (title: string) => {
  const nodes = all();
  const at = nodes.findIndex((e) => e.tag === "h5" && e.text() === title);
  return nodes.slice(at).find((e) => e.tag === "dl") as FakeEl;
};
const rows = (d: FakeEl) => {
  const out: Record<string, string> = {};
  const k = d.children;
  for (let i = 0; i < k.length; i += 2) out[k[i].text()] = k[i + 1].text();
  return out;
};

test("UI-1138 Cloud details holds File, Counts and View as kv lists, the Original and Active status values and Remove invalid; with no session it says No file open", () => {
  expect(dom.root.text()).toBe("No file open");
  store.set({
    session: sessionFixture({
      filename: "room.pcd",
      schema: [{ name: "x", size: 4, type: "F", count: 1 }, { name: "y", size: 4, type: "F", count: 1 }] as never,
      counts: { original: 1000, active: 900, deleted: 100, invalid_total: 5, invalid_active: 3, displayed: 800, selected: 0, protected: 0, main: 0, hidden: 0 },
    }),
  });
  expect(all().find((e) => e.tag === "h4")?.text()).toBe("Cloud details");
  expect(all().filter((e) => e.tag === "h5").map((e) => e.text())).toEqual(["File", "Counts", "View"]);
  expect(all().filter((e) => e.tag === "dl").every((e) => e.className === "kv" || e.className.split(" ").includes("kv"))).toBe(true);
  expect(rows(dl("File"))).toEqual({ Name: "room.pcd", Encoding: "binary", Fields: "x, y", Unit: "m (assumed)", Min: "0, 0, 0", Max: "10, 10, 10" });
  const counts = all().find((e) => e.getAttribute("id") === "counts-panel") as FakeEl;
  expect(rows(counts)).toEqual({ Original: "1,000", Active: "900", Remaining: "900", Deleted: "100 (10.00%)", Invalid: "3 / 5" });
  const dd = (n: string) => counts.children.find((e) => e.tag === "dd" && e.getAttribute("data-status") === n) as FakeEl;
  expect(dd("Original").text()).toBe("1,000");
  expect(dd("Active").text()).toBe("900");
  expect(Object.keys(rows(dl("View")))).toEqual(expect.arrayContaining(["Projection", "Pivot"]));
  const ri = all().find((e) => e.getAttribute("id") === "remove-invalid") as FakeEl;
  expect(ri.hidden).toBe(false);
  expect(ri.text()).toBe("Remove 3 invalid");
  store.set({ session: sessionFixture() });
  expect((all().find((e) => e.getAttribute("id") === "remove-invalid") as FakeEl).hidden).toBe(true);
});
