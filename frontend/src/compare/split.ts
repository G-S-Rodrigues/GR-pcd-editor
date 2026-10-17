export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Left (original) and right (edited) halves of the canvas; together they cover it exactly. */
export function splitRects(w: number, h: number): [Rect, Rect] {
  const left = Math.floor(w / 2);
  return [
    { x: 0, y: 0, w: left, h },
    { x: left, y: 0, w: w - left, h },
  ];
}
