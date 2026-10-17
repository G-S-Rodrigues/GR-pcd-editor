export type FieldGroup = "tool" | "box" | "polygon" | "cluster" | "filter" | "protection" | "history" | "slice";
export interface FieldSpec {
  id: string;
  label: string;
  group: FieldGroup;
  tooltip: string;
}

const AX = ["x", "y", "z"] as const;
const up = (s: string) => s.toUpperCase();
const f = (id: string, label: string, group: FieldGroup, tooltip: string): FieldSpec => ({ id, label, group, tooltip });

/** Every tool, filter, protection and history control; the DOM binders, describeControls and the tooltips read this list. */
export const FIELD_SPECS: FieldSpec[] = [
  f("tool-box", "Box", "tool", "Select points inside (or outside) an oriented box set by numbers or by dragging its handles"),
  f("tool-polygon", "Polygon", "tool", "Select points inside a polygon drawn in the top view, optionally limited by Z"),
  f("tool-cluster", "Cluster", "tool", "Select the connected cluster around a picked seed point within a radius"),
  f("op-select", "Operation", "tool", "Replace updates the preview live; Add, Subtract and Intersect stay a draft until you press the commit button"),
  f("scope-select", "Scope", "tool", "Displayed: only points that pass the display filter. Active: every point still in the cloud"),
  f("sel-commit", "Commit draft", "tool", "Combine the drafted tool shape with the current selection using the chosen operation"),
  f("sel-select-displayed", "Select displayed", "tool", "Select every displayed point (those passing the display filter), including points not drawn"),
  f("sel-invert", "Invert", "tool", "Invert the selection relative to the chosen scope"),
  f("sel-clear", "Clear selection", "tool", "Clear the whole selection; nothing is deleted"),
  f("remove-invalid", "Remove invalid", "tool", "Remove points whose coordinates are NaN or infinite from the active cloud (undoable)"),
  ...AX.map((a) => f(`box-center-${a}`, `Centre ${up(a)}`, "box", `Box centre ${up(a)} coordinate in the file frame`)),
  ...AX.map((a) => f(`box-size-${a}`, `Size ${up(a)}`, "box", `Box size along its local ${up(a)} axis; must be greater than 0`)),
  f("box-roll", "Roll", "box", "Box roll in degrees (rotation about X; convention Rz(yaw) Ry(pitch) Rx(roll))"),
  f("box-pitch", "Pitch", "box", "Box pitch in degrees (rotation about Y)"),
  f("box-yaw", "Yaw", "box", "Box yaw in degrees (rotation about Z)"),
  ...AX.map((a) => f(`box-min-${a}`, `Min ${up(a)}`, "box", `Box minimum ${up(a)} edge; editable only for an unrotated box`)),
  ...AX.map((a) => f(`box-max-${a}`, `Max ${up(a)}`, "box", `Box maximum ${up(a)} edge; editable only for an unrotated box`)),
  f("box-mode", "Box mode", "box", "Inside selects points in the box; outside selects everything else"),
  f("box-reset-rotation", "Reset rotation", "box", "Set the box roll, pitch and yaw back to 0"),
  f("box-reset", "Reset box", "box", "Replace the box by a unit box at the orbit pivot"),
  f("box-fit-cloud", "Fit cloud", "box", "Make the box exactly cover the active cloud"),
  f("box-fit-selection", "Fit selection", "box", "Make the box exactly cover the current candidate"),
  f("box-rect", "Rect", "box", "Rectangle select: drag a rectangle in a face view (ViewCube) to make the box; the depth is the slice slab or the whole cloud. Hold R for the same"),
  f("box-fit-view", "Fit to view", "box", "Make the box cover everything visible in this face view, across the whole depth of the cloud"),
  f("box-fit-displayed", "Fit displayed", "box", "Make the box cover the displayed points: the active cloud narrowed by the display filter"),
  f("gizmo-snap", "Snap", "box", "Snap handle drags to the step sizes below; hold Shift for fine (x0.1) drags"),
  f("gizmo-step", "Snap step", "box", "Translation snap step in the file unit"),
  f("gizmo-angle-step", "Angle step", "box", "Rotation snap step in degrees"),
  f("gizmo-frame", "Axes", "box", "Translate along world axes or the box's own axes"),
  f("poly-draw", "Draw polygon", "polygon", "Start drawing: click in the top view to add vertices"),
  f("poly-finish", "Close polygon", "polygon", "Close the polygon and preview (Enter)"),
  f("poly-cancel", "Cancel drawing", "polygon", "Stop drawing and restore the previous polygon (Escape)"),
  f("poly-clear", "Clear polygon", "polygon", "Remove the polygon"),
  f("poly-zmin", "Z min", "polygon", "Lower Z limit of the polygon prism; the default is unlimited"),
  f("poly-zmax", "Z max", "polygon", "Upper Z limit of the polygon prism; the default is unlimited"),
  f("poly-mode", "Polygon mode", "polygon", "Inside selects points in the prism; outside selects everything else"),
  f("cluster-pick-seed", "Pick seed", "cluster", "Click a point in the view to use it as the cluster seed"),
  f("cluster-radius", "Radius", "cluster", "Neighbour radius in the file unit; points closer than this join the cluster"),
  f("cluster-region", "Region", "cluster", "Limit the cluster search to the current box or polygon"),
  f("cluster-exclude-protected", "Exclude protected", "cluster", "Do not let the cluster grow through height-protected points"),
  f("cluster-max-points", "Max points", "cluster", "Stop and report if the cluster grows past this many points"),
  f("cluster-cancel", "Cancel", "cluster", "Cancel the running cluster computation"),
  ...AX.flatMap((a) => [
    f(`filter-${a}-enabled`, `${up(a)} filter`, "filter", `Hide points outside the ${up(a)} range; this does not delete them`),
    f(`filter-${a}-min`, `${up(a)} min`, "filter", `Lowest displayed ${up(a)} (inclusive)`),
    f(`filter-${a}-max`, `${up(a)} max`, "filter", `Highest displayed ${up(a)} (inclusive)`),
    f(`filter-${a}-min-slider`, `${up(a)} min slider`, "filter", `Drag the lowest displayed ${up(a)} within the cloud bounds`),
    f(`filter-${a}-max-slider`, `${up(a)} max slider`, "filter", `Drag the highest displayed ${up(a)} within the cloud bounds`),
  ]),
  f("filter-reset-bounds", "Reset to cloud", "filter", "Set the filter limits to the whole cloud bounds and turn the filters off"),
  f("filter-reset-all", "Reset filters", "filter", "Turn all display filters off"),
  f("slice-enabled", "Slice view", "slice", "Draw only a slab of the cloud (view only: selection, filters and counts are not affected)"),
  f("slice-axis", "Slice axis", "slice", "Axis the slab is cut across"),
  f("slice-centre", "Slice centre", "slice", "Centre of the slab along its axis, in the file frame"),
  f("slice-thickness", "Slice thickness", "slice", "Thickness of the slab; must be greater than 0"),
  f("slice-from-box", "Slice from box", "slice", "Make the slab cover the box along the view axis (or the slice axis outside a face view)"),
  f("slice-at-point", "Slice at point", "slice", "Click a point in the view: the slab is centred on it along the slice axis"),
  f("slice-prev", "Slice back", "slice", "Move the slab one thickness toward lower values (key [)"),
  f("slice-next", "Slice forward", "slice", "Move the slab one thickness toward higher values (key ])"),
  f("slice-off", "Slice off", "slice", "Draw the whole cloud again"),
  f("prot-enabled", "Global protection", "protection", "Protect every point whose Z is inside the interval from deletion; off by default"),
  f("prot-min", "Protect min Z", "protection", "Lower Z of the protected slab (inclusive)"),
  f("prot-max", "Protect max Z", "protection", "Upper Z of the protected slab (inclusive)"),
  f("prot-pick-floor", "Pick floor point", "protection", "Click a floor point in the view: global protection is set to its Z plus or minus the half thickness"),
  f("prot-floor-t", "Floor half thickness", "protection", "Half thickness of the slab made by Pick floor point, in the file unit"),
  f("prot-mode", "Operation protection", "protection", "Inherit uses the global slab; add a local slab for one operation; or override the global slab"),
  f("prot-local-min", "Local min Z", "protection", "Lower Z of the local protected slab for this operation"),
  f("prot-local-max", "Local max Z", "protection", "Upper Z of the local protected slab for this operation"),
  f("prot-ack", "Acknowledge override", "protection", "Confirm that this operation ignores the global protection"),
];
