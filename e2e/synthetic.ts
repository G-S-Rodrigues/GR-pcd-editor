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

/**
 * Small room scene: a 20 x 20 floor grid (z 0), a wall strip, a 3 x 3 x 3 ghost blob behind a mirror
 * (y 12..14), nine ghost points inside the floor slab (z 0.02), noise, one NaN. Truth is counted here,
 * independently of the app.
 */
export const ROOM = { floor: 400, wall: 40, ghost: 27, floorGhost: 9, noise: 4, invalid: 1 };
export const ROOM_TOTAL = ROOM.floor + ROOM.wall + ROOM.ghost + ROOM.floorGhost + ROOM.noise + ROOM.invalid;

export function roomPcd(): Buffer {
  const rows: string[] = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) rows.push(`${x} ${y} 0 0.5`);
  for (let y = 0; y < 10; y++) for (let z = 1; z < 5; z++) rows.push(`-1 ${y} ${z} 0.7`);
  for (let x = 2; x < 5; x++) for (let y = 12; y < 15; y++) for (let z = 1; z < 4; z++) rows.push(`${x} ${y} ${z} 1.5`);
  for (let x = 2; x < 5; x++) for (let y = 12; y < 15; y++) rows.push(`${x} ${y + 0.5} 0.02 1.5`);
  for (const [x, y, z] of [[15.5, 15.5, 2], [16.5, 3.5, 3], [8.5, 8.5, 2.5], [1.5, 17.5, 1.5]]) rows.push(`${x} ${y} ${z} 0.1`);
  rows.push("nan 0 0 2");
  const head = ["# .PCD v.7 - synthetic room", "VERSION .7", "FIELDS x y z intensity", "SIZE 4 4 4 4", "TYPE F F F F",
    "COUNT 1 1 1 1", `WIDTH ${rows.length}`, "HEIGHT 1", "VIEWPOINT 0 0 0 1 0 0 0", `POINTS ${rows.length}`, "DATA ascii"];
  return Buffer.from(`${head.join("\n")}\n${rows.join("\n")}\n`);
}

/**
 * 990,000-point scene (E2E-27): a 1000 x 600 floor grid at z 0 (600,000, x 0..99.9, y 0..59.9) and a ghost block
 * behind it (x 20..39.8, y 62..71.8, 78 layers from z 0.02 in steps of 0.1: 390,000). The 5,000 ghosts of the
 * first layer lie inside a +-0.05 floor protection slab. Returned as float32 xyz triples.
 */
export const BIG = { floor: 600_000, ghost: 390_000, ghostInSlab: 5_000 };
export function bigRoomXyz(): Float32Array {
  const out = new Float32Array((BIG.floor + BIG.ghost) * 3);
  let o = 0;
  for (let x = 0; x < 1000; x++) for (let y = 0; y < 600; y++) { out[o++] = x / 10; out[o++] = y / 10; out[o++] = 0; }
  for (let x = 0; x < 100; x++) for (let y = 0; y < 50; y++) for (let k = 0; k < 78; k++) { out[o++] = 20 + x * 0.2; out[o++] = 62 + y * 0.2; out[o++] = 0.02 + k * 0.1; }
  return out;
}
export function bigRoomPcd(xyz: Float32Array): Buffer {
  const n = xyz.length / 3;
  const head = ["# .PCD v.7 - synthetic big room", "VERSION .7", "FIELDS x y z", "SIZE 4 4 4", "TYPE F F F", "COUNT 1 1 1",
    `WIDTH ${n}`, "HEIGHT 1", "VIEWPOINT 0 0 0 1 0 0 0", `POINTS ${n}`, "DATA binary"];
  return Buffer.concat([Buffer.from(`${head.join("\n")}\n`), Buffer.from(xyz.buffer, xyz.byteOffset, xyz.byteLength)]);
}
/** Independent count of rows inside an axis-aligned box (centre, size; inclusive) and, of those, inside a z slab. */
export function countInXyz(xyz: Float32Array, c: number[], d: number[], slab?: [number, number]): number {
  let n = 0;
  for (let i = 0; i < xyz.length; i += 3) {
    if (Math.abs(xyz[i] - c[0]) <= d[0] / 2 && Math.abs(xyz[i + 1] - c[1]) <= d[1] / 2 && Math.abs(xyz[i + 2] - c[2]) <= d[2] / 2 && (!slab || (xyz[i + 2] >= slab[0] && xyz[i + 2] <= slab[1]))) n++;
  }
  return n;
}

/**
 * Tilted floor scene (E2E-44, E2E-45): a 20 x 20 floor grid on the plane z = 0.1 x + 0.05 y (one point per
 * cell, a vertical offset of -0.02, 0 or +0.02 in a fixed pattern) and a 3 x 3 x 3 ghost block 1..3 m above
 * that plane at x 2..4, y 12..14. Truth is counted here, independently of the app.
 */
export const TILTED = { floor: 400, ghost: 27, a: 0.1, b: 0.05, half: 0.03 };

export function tiltedFloorPcd(): Buffer {
  const rows: string[] = [];
  const plane = (x: number, y: number) => TILTED.a * x + TILTED.b * y;
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) rows.push(`${x} ${y} ${plane(x, y) + ((x + y) % 3 - 1) * 0.02} 0.5`);
  for (let x = 2; x < 5; x++) for (let y = 12; y < 15; y++) for (let k = 1; k < 4; k++) rows.push(`${x} ${y} ${plane(x, y) + k} 1.5`);
  const head = ["# .PCD v.7 - synthetic tilted floor", "VERSION .7", "FIELDS x y z intensity", "SIZE 4 4 4 4", "TYPE F F F F",
    "COUNT 1 1 1 1", `WIDTH ${rows.length}`, "HEIGHT 1", "VIEWPOINT 0 0 0 1 0 0 0", `POINTS ${rows.length}`, "DATA ascii"];
  return Buffer.from(`${head.join("\n")}\n${rows.join("\n")}\n`);
}

/** Tilt angles (deg) whose slab normal is the floor normal. Independent of the app: from the plane equation. */
export function tiltedFloorAngles(): { rx: number; ry: number } {
  const len = Math.hypot(TILTED.a, TILTED.b, 1);
  return { rx: (Math.asin(TILTED.b / len) * 180) / Math.PI, ry: (Math.atan(-TILTED.a) * 180) / Math.PI };
}

/** Points whose slab coordinate lies in [min, max] (inclusive): the oracle for the tilted protection slab. */
export function countInTiltedSlab(rows: number[][], rxDeg: number, ryDeg: number, pivot: number[], min: number, max: number): number {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const n = [Math.cos(rx) * Math.sin(ry), -Math.sin(rx), Math.cos(rx) * Math.cos(ry)];
  return rows.filter((r) => {
    const s = n[0] * (r[0] - pivot[0]) + n[1] * (r[1] - pivot[1]) + n[2] * r[2];
    return s >= min - 1e-9 && s <= max + 1e-9;
  }).length;
}
