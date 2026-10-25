import type { FakeEl } from "./fakedom";
import type { LayerMenuHost } from "../ui/layerspanel";

/** A recording stand-in for the `#layer-menu` popover host: tests read `calls` and `panel`. */
export function fakeLayerMenu(panel: FakeEl) {
  let open: string | null = null;
  let anchor: unknown = null;
  const calls: { toggleAt: unknown[]; reanchor: unknown[]; close: number } = { toggleAt: [], reanchor: [], close: 0 };
  const host: LayerMenuHost = {
    panel: panel as unknown as HTMLElement,
    toggleAt: (el) => {
      calls.toggleAt.push(el);
      if (open === "layer" && anchor === el) open = null;
      else {
        open = "layer";
        anchor = el;
      }
    },
    reanchor: (el) => {
      calls.reanchor.push(el);
      anchor = el;
    },
    close: () => {
      calls.close++;
      open = null;
    },
    openId: () => open,
  };
  return { host, calls, isOpen: () => open === "layer", closeFromOutside: () => (open = null) };
}
