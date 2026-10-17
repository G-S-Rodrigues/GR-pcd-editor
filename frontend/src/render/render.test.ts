import { expect, test } from "vitest";
import { lodLabel } from "./lod";
import { toLocal, toWorld } from "./origin";
import { parseRender, renderQuery } from "./parse";

function body(n: number, attr?: Float32Array) {
  const coords = new Float32Array(n * 3).map((_, i) => i + 0.5);
  const ids = new Uint32Array(n).map((_, i) => 100 + i);
  const flags = new Uint8Array(n).map((_, i) => i % 3);
  const parts = [coords.buffer, ids.buffer, flags.buffer, ...(attr ? [attr.buffer] : [])];
  const total = parts.reduce((a, p) => a + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), o);
    o += p.byteLength;
  }
  return { buf: out.buffer, coords, ids, flags };
}
const hdr = (h: Record<string, string>) => ({ get: (k: string) => h[k] ?? null });
const H = {
  "X-Origin": "1.5,2.5,-3.25",
  "X-Count": "3",
  "X-Eligible": "30",
  "X-Cloud-Revision": "4",
  "X-Params-Revision": "5",
};

test("UI-05 parseRender splits coords/ids/flags", () => {
  const b = body(3);
  const r = parseRender(b.buf, hdr(H));
  expect([...r.coords]).toEqual([...b.coords]);
  expect([...r.ids]).toEqual([100, 101, 102]);
  expect([...r.flags]).toEqual([0, 1, 2]);
  expect(r.origin).toEqual([1.5, 2.5, -3.25]);
  expect(r).toMatchObject({ count: 3, eligible: 30, cloudRevision: 4, paramsRevision: 5 });
  expect(r.attr).toBeUndefined();
});

test("UI-05 parseRender reads the unaligned attr block", () => {
  const b = body(3, new Float32Array([0.25, 0.5, 0.75]));
  const r = parseRender(b.buf, hdr({ ...H, "X-Attr-Field": "intensity", "X-Attr-Kind": "f32" }));
  expect(r.attrField).toBe("intensity");
  expect([...(r.attr as Float32Array)]).toEqual([0.25, 0.5, 0.75]);
});

test("UI-05 short/long buffers are typed errors, zero points ok", () => {
  const b = body(3);
  expect(() => parseRender(b.buf.slice(0, 20), hdr(H))).toThrowError(
    expect.objectContaining({ code: "bad_render" }),
  );
  expect(() => parseRender(new ArrayBuffer(b.buf.byteLength + 1), hdr(H))).toThrowError(
    expect.objectContaining({ code: "bad_render" }),
  );
  const z = parseRender(new ArrayBuffer(0), hdr({ ...H, "X-Count": "0", "X-Eligible": "0" }));
  expect(z.count).toBe(0);
  expect(z.coords.length).toBe(0);
});

test("UI-06 toWorld/toLocal round-trip exactly at large origins", () => {
  for (const o of [1e6, 1e7]) {
    const origin: [number, number, number] = [o, -o, o + 0.5];
    const local = [...new Float32Array([0.125, -37.5, 99.0625])] as [number, number, number];
    const w = toWorld(local, origin);
    expect(w[0]).toBe(o + 0.125);
    expect(toLocal(w, origin)).toEqual(local);
  }
});

test("UI-07 lodLabel", () => {
  expect(lodLabel({ count: 100000, eligible: 1234567, budget: 100000 })).toBe(
    "Rendered 100,000 of 1,234,567 eligible (sampled to budget)",
  );
  expect(lodLabel({ count: 5000, eligible: 5000, budget: 300000 })).toBe(
    "Rendered all 5,000 eligible points",
  );
  expect(lodLabel({ count: 50, eligible: 100, budget: 50 })).toContain("sampled to budget");
  expect(lodLabel({ count: 1, eligible: 1, budget: 1 })).not.toMatch(/total/);
});

test("UI-08 renderQuery builds and clamps", () => {
  expect(renderQuery("edited", 300000)).toBe("mode=edited&budget=300000");
  expect(renderQuery("original", 5_000_000, "rgb")).toBe("mode=original&budget=2000000&attr=rgb");
  expect(renderQuery("deleted", 0)).toBe("mode=deleted&budget=1");
  expect(renderQuery("edited", 12.7)).toBe("mode=edited&budget=12");
});
