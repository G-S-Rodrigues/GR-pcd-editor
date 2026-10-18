import { control } from "./controls";
import { describeControls } from "./describe";
import { type IconName, iconSvg } from "./icons";

const LABELS = new Map(describeControls().map((d) => [d.id, d.label]));

/** An icon-only registered button: the name comes from the describe label, the tooltip from TOOLTIPS, the svg is decorative. */
export function iconControl(
  id: string,
  icon: IconName,
  props: Record<string, unknown> & { disabled?: boolean; reason?: string } = {},
): HTMLButtonElement {
  const label = LABELS.get(id);
  if (!label) throw new Error(`icon control ${id} is not described`);
  const cls = ["ib", props.class].filter(Boolean).join(" ");
  return control("button", { type: "button", ...props, id, class: cls, "aria-label": label }, iconSvg(icon));
}
