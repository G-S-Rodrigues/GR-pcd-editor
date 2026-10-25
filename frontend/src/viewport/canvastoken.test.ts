import { expect, test } from "vitest";
import { followCanvasToken } from "./canvastoken";

test("UI-1091 the clear colour is applied once at start and again on every theme change, trimmed, and stops after the unsubscribe", () => {
  let token = " #0c0d10 ";
  const applied: string[] = [];
  let fire: (() => void) | null = null;
  let unsubscribed = 0;
  const stop = followCanvasToken({
    read: () => token,
    subscribe: (cb) => {
      fire = cb;
      return () => {
        unsubscribed++;
        fire = null;
      };
    },
    apply: (c) => applied.push(c),
  });
  expect(applied).toEqual(["#0c0d10"]);
  token = "#e9ebef";
  fire!();
  expect(applied).toEqual(["#0c0d10", "#e9ebef"]);
  stop();
  expect(unsubscribed).toBe(1);
  expect(fire).toBeNull();
});
