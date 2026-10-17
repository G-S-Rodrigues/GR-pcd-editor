export type Vec2 = [number, number];

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: Vec2, b: Vec2, p: Vec2) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/**
 * Mirrors backend `geometry/prism.py validate_polygon` (same checks, same order) so the client rejects what the
 * server rejects. Returns a message, or null when the polygon is valid.
 */
export function validatePolygon(poly: readonly Vec2[]): string | null {
  const n = poly.length;
  if (n < 3) return "A polygon needs at least 3 vertices";
  if (poly.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return "Vertices must be finite numbers";
  const nxt = (i: number) => poly[(i + 1) % n];
  for (let i = 0; i < n; i++) {
    if (poly[i][0] === nxt(i)[0] && poly[i][1] === nxt(i)[1]) return "Polygon has duplicate consecutive vertices";
  }
  let area2 = 0;
  for (let i = 0; i < n; i++) area2 += poly[i][0] * nxt(i)[1] - nxt(i)[0] * poly[i][1];
  if (area2 === 0) return "Polygon has zero area";
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = nxt(i);
    const c = poly[(i + 2) % n];
    if (orient(a, b, c) === 0 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0) {
      return "Polygon edges fold back on each other";
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const cc = poly[j];
      const dd = nxt(j);
      const o1 = orient(a, b, cc);
      const o2 = orient(a, b, dd);
      const o3 = orient(cc, dd, a);
      const o4 = orient(cc, dd, b);
      if (
        (o1 * o2 < 0 && o3 * o4 < 0) ||
        (o1 === 0 && onSegment(a, b, cc)) ||
        (o2 === 0 && onSegment(a, b, dd)) ||
        (o3 === 0 && onSegment(cc, dd, a)) ||
        (o4 === 0 && onSegment(cc, dd, b))
      ) {
        return "Polygon is self-intersecting";
      }
    }
  }
  return null;
}
