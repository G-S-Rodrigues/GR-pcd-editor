import { expect, test } from "vitest";
import { initialState } from "../state/app";
import { candidateFixture, sessionFixture } from "../testing/fixtures";
import { headline } from "./headline";

const st = (cand: Parameters<typeof candidateFixture>[0] | null, rev = { cloud: 3, params: 4 }) => ({
  ...initialState(),
  session: sessionFixture({ revision: rev }),
  candidate: cand === null ? null : candidateFixture(cand),
});

test("UI-127 headline numbers come from the current candidate", () => {
  const h = headline(st({ candidates: 43, protected_retained: 0 }));
  expect(h.willDelete).toBe("Will delete 43");
  expect(h.kept).toBe("Kept by protection 0");
  expect(h.warning).toBeNull();
});

test("UI-127 kept points raise the ghosts-in-the-floor-slab warning", () => {
  const h = headline(st({ candidates: 32825, protected_retained: 9 }));
  expect(h.willDelete).toBe("Will delete 32,825");
  expect(h.kept).toBe("Kept by protection 9");
  expect(h.keptCount).toBe(9);
  expect(h.warning).toBe("9 selected points lie inside the protected interval and will be kept (ghosts in the floor slab?)");
  expect(headline(st({ candidates: 1, protected_retained: 1 })).warning).toBe(
    "1 selected point lies inside the protected interval and will be kept (ghosts in the floor slab?)",
  );
});

test("UI-127 no candidate or a stale one shows dashes and no warning", () => {
  for (const s of [st(null), st({ protected_retained: 5 }, { cloud: 9, params: 4 }), { ...initialState() }]) {
    const h = headline(s);
    expect(h.willDelete).toBe("Will delete —");
    expect(h.kept).toBe("Kept by protection —");
    expect(h.warning).toBeNull();
    expect(h.keptCount).toBe(0);
  }
});

test("UI-160 kept points offer a one-click 'also delete' whose label comes from the model", () => {
  const h = headline(st({ candidates: 100, protected_retained: 4 }));
  expect(h.deleteKeptLabel).toBe("Also delete the 4 kept points (this operation only)");
  expect(headline(st({ candidates: 100, protected_retained: 1 })).deleteKeptLabel).toBe("Also delete the 1 kept point (this operation only)");
});

test("UI-161 the 'also delete' offer is hidden when nothing is kept, stale or absent", () => {
  expect(headline(st({ candidates: 10, protected_retained: 0 })).deleteKeptLabel).toBeNull();
  expect(headline(st({ protected_retained: 5 }, { cloud: 9, params: 4 })).deleteKeptLabel).toBeNull();
  expect(headline(st(null)).deleteKeptLabel).toBeNull();
});
