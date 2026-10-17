import { describe, expect, it, vi } from "vitest";
import { createParamsHook } from "./params";

describe("params hook", () => {
  it("UI-103 filter and protection changes both re-run the preview and redraw the canvas", () => {
    const calls: string[] = [];
    const runner = { paramsChanged: vi.fn((k: string) => void calls.push(`runner:${k}`)) };
    const refresh = vi.fn(() => void calls.push("refresh"));
    const hook = createParamsHook(runner, refresh);
    hook("filter");
    hook("protection");
    expect(calls).toEqual(["runner:filter", "refresh", "runner:protection", "refresh"]);
  });
});
