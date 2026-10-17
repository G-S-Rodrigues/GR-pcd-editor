import { describe, expect, it } from "vitest";
import { candidateFixture } from "../testing/fixtures";
import {
  PROTECTION_COPY,
  dragPlane,
  effectiveText,
  emptyProtection,
  protectionFromState,
  resetOperation,
  retainedText,
  setGlobal,
  setLocal,
  setOperationMode,
  toProtectionBody,
  acknowledge,
} from "./protection";

describe("protection model", () => {
  it("UI-56 global interval defaults disabled; enabling needs min<=max; body key is `global`", () => {
    const m = emptyProtection();
    expect(m.global.enabled).toBe(false);
    const ok = setGlobal(m, { enabled: true, min: -0.2, max: 0.3 });
    expect(ok.ok).toBe(true);
    expect(setGlobal(m, { enabled: true, min: 2, max: 1 }).ok).toBe(false);
    expect(setGlobal(m, { enabled: true, min: NaN, max: 1 }).ok).toBe(false);
    const r = toProtectionBody(ok.model);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.global).toEqual({ enabled: true, min: -0.2, max: 0.3 });
      expect("global_" in r.body).toBe(false);
    }
  });

  it("UI-57 modes: add_local needs local; override needs the acknowledgement (AC-07)", () => {
    let m = emptyProtection();
    m = setOperationMode(m, "add_local");
    let r = toProtectionBody(m);
    expect(r.ok).toBe(false);
    m = setLocal(m, { min: 1, max: 2 }).model;
    r = toProtectionBody(m);
    expect(r.ok && r.body.operation).toEqual({ mode: "add_local", local: { min: 1, max: 2 }, acknowledge_override: false });
    m = setOperationMode(m, "override");
    r = toProtectionBody(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ack_required");
      expect(r.message).toMatch(/acknowledge/i);
    }
    m = acknowledge(m, true);
    r = toProtectionBody(m);
    expect(r.ok && r.body.operation.acknowledge_override).toBe(true);
    expect(setLocal(m, { min: 3, max: 1 }).ok).toBe(false);
  });

  it("UI-58 operation protection is per operation: reset to inherit after apply, global stays", () => {
    let m = setGlobal(emptyProtection(), { enabled: true, min: 0, max: 1 }).model;
    m = acknowledge(setLocal(setOperationMode(m, "override"), { min: 5, max: 6 }).model, true);
    const after = resetOperation(m);
    const r = toProtectionBody(after);
    expect(r.ok && r.body.operation).toEqual({ mode: "inherit", local: null, acknowledge_override: false });
    expect(r.ok && r.body.global).toEqual({ enabled: true, min: 0, max: 1 });
  });

  it("UI-59 retained count and effective intervals come from the candidate", () => {
    const c = candidateFixture({ protected_retained: 12, effective_protection: { mode: "override", intervals: [[5, 6]] } });
    expect(retainedText(c)).toBe("12 selected points will be retained by protection");
    expect(effectiveText(c)).toMatch(/override/);
    expect(effectiveText(c)).toMatch(/5.*6/);
    expect(retainedText(null)).toBe("");
    expect(PROTECTION_COPY).toMatch(/coordinate slab/);
    expect(PROTECTION_COPY).toMatch(/not a semantic floor/);
    expect(PROTECTION_COPY).toMatch(/no ramps/i);
    expect(protectionFromState({ global: { enabled: true, min: 1, max: 2 }, operation: { mode: "inherit", local: null, acknowledge_override: false } }).global.max).toBe(2);
  });

  it("UI-60 height plane drag maps a Z delta to the limits and keeps min<=max", () => {
    const m = setGlobal(emptyProtection(), { enabled: true, min: 0, max: 1 }).model;
    expect(dragPlane(m, "global", "max", 0.5).global.max).toBe(1.5);
    expect(dragPlane(m, "global", "min", 5).global.min).toBe(1); // clamped to max
    expect(dragPlane(m, "global", "max", -5).global.max).toBe(0);
    const l = setLocal(m, { min: 2, max: 3 }).model;
    expect(dragPlane(l, "local", "min", -1).local).toEqual({ min: 1, max: 3 });
  });
});
