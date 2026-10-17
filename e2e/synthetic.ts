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

export interface ParsedPcd {
  header: Record<string, string>;
  fields: string[];
  rows: number[][];
}

/** Independent PCD reader for the smoke: ascii or binary, scalar float32/uint32 fields only. */
export function parsePcd(buf: Buffer): ParsedPcd {
  const marker = buf.indexOf("DATA ");
  const eol = buf.indexOf("\n", marker);
  const header: Record<string, string> = {};
  for (const line of buf.subarray(0, eol).toString("latin1").split("\n")) {
    const i = line.indexOf(" ");
    if (i > 0 && !line.startsWith("#")) header[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  const fields = header.FIELDS.split(" ");
  const sizes = header.SIZE.split(" ").map(Number);
  const types = header.TYPE.split(" ");
  const n = Number(header.POINTS);
  const body = buf.subarray(eol + 1);
  const rows: number[][] = [];
  if (header.DATA === "ascii") {
    for (const line of body.toString("latin1").split("\n")) {
      if (line.trim() !== "") rows.push(line.trim().split(/\s+/).map(Number));
    }
  } else if (header.DATA === "binary") {
    const stride = sizes.reduce((a, b) => a + b, 0);
    for (let r = 0; r < n; r++) {
      let off = r * stride;
      const row: number[] = [];
      for (let f = 0; f < fields.length; f++) {
        row.push(types[f] === "F" ? body.readFloatLE(off) : body.readUInt32LE(off));
        off += sizes[f];
      }
      rows.push(row);
    }
  } else throw new Error(`unsupported DATA ${header.DATA}`);
  return { header, fields, rows };
}

/** Fixture truth: every record (floor, ghost, invalid) as "x,y,z,intensity" keys. */
export function truthKeys(includeGhost: boolean): string[] {
  const keys = syntheticPcdRows().filter((r) => includeGhost || r[3] !== 1.5).map((r) => r.join(","));
  return keys.sort();
}
export const rowKey = (r: number[]) => r.join(",");

function syntheticPcdRows(): number[][] {
  const rows: number[][] = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) rows.push([x, y, 0, 0.5]);
  for (let x = 2; x < 5; x++) for (let y = 2; y < 5; y++) for (let z = 1; z < 4; z++) rows.push([x, y, z, 1.5]);
  rows.push([Number.NaN, 0, 0, 2]);
  return rows;
}
