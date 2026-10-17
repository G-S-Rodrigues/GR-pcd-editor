// Fully synthetic PCD generated in code: flat floor, a "ghost" blob above it, one invalid point.
export const FLOOR = 100;
export const GHOST = 27;
export const INVALID = 1;
export const TOTAL = FLOOR + GHOST + INVALID;

export function syntheticPcd(): Buffer {
  const rows: string[] = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) rows.push(`${x} ${y} 0 0.5`);
  for (let x = 2; x < 5; x++) for (let y = 2; y < 5; y++) for (let z = 1; z < 4; z++) rows.push(`${x} ${y} ${z} 1.5`);
  rows.push("nan 0 0 2");
  const head = [
    "# .PCD v.7 - synthetic test cloud",
    "VERSION .7",
    "FIELDS x y z intensity",
    "SIZE 4 4 4 4",
    "TYPE F F F F",
    "COUNT 1 1 1 1",
    `WIDTH ${rows.length}`,
    "HEIGHT 1",
    "VIEWPOINT 0 0 0 1 0 0 0",
    `POINTS ${rows.length}`,
    "DATA ascii",
  ];
  return Buffer.from(`${head.join("\n")}\n${rows.join("\n")}\n`);
}
