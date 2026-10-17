import { h } from "./dom";
import { TOOLTIPS } from "./tooltips";

export interface ControlSpec {
  id: string;
  tooltip: string;
}

export function createRegistry() {
  const seen = new Map<string, ControlSpec>();
  return {
    register(spec: ControlSpec): void {
      if (!spec.tooltip || spec.tooltip.trim() === "") {
        throw new Error(`control ${spec.id} needs a tooltip`);
      }
      if (seen.has(spec.id)) throw new Error(`duplicate control id ${spec.id}`);
      seen.set(spec.id, spec);
    },
    ids: () => [...seen.keys()],
  };
}

export const registry = createRegistry();

/** Builds a registered control; id and tooltip are mandatory (the tooltip is looked up if omitted). */
export function control<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  spec: { id: string; tooltip?: string; disabled?: boolean; reason?: string } & Record<string, unknown>,
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const tooltip = spec.tooltip ?? TOOLTIPS[spec.id] ?? "";
  registry.register({ id: spec.id, tooltip });
  const { reason, tooltip: _t, ...rest } = spec;
  const title = spec.disabled && reason ? `${tooltip} (${reason})` : tooltip;
  return h(tag, { ...rest, "data-control": spec.id, title }, ...children);
}
