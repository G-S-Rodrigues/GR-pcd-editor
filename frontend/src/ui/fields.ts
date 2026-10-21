export type FieldGroup = "tool" | "box" | "polygon" | "cluster" | "sparse" | "filter" | "protection" | "history" | "layer";

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
  f("tool-sparse", "Sparse points", "tool", "Select isolated points with few neighbours (floating artifacts) while walls and floors stay; set the radius and neighbour count below"),
  f("op-select", "Operation", "tool", "How the tool shape combines with the selection. The first selection you draw is live (no operation pressed); once something is selected, Add, Subtract and Intersect preview the result (added points in magenta, removed in blue) and change the selection only when you press Commit draft"),
  f("op-add", "Add to selection", "tool", "Add the tool shape to the selection: the result is previewed and applied on Commit (the first selection you draw is live)"),
  f("op-subtract", "Subtract from selection", "tool", "Remove the tool shape's points from the selection; previewed, applied on Commit"),
  f("op-intersect", "Intersect with selection", "tool", "Keep only the selected points that are also in the tool shape; previewed, applied on Commit"),
  f("preview-live", "Live preview", "tool", "On: shape edits preview the result at once. Off: edits only move the outline and Commit computes and applies the result in one step (the first selection is always live)"),
  f("scope-select", "Scope", "tool", "Displayed: only points that pass the display filter. Active: every point still in the cloud"),
  f("sel-colour", "Selected colour", "tool", "Colour of the selected points on the canvas (view only; saved with the session). Pick one that stands out from the cloud colours"),
  f("sel-colour-orange", "Selected colour Orange", "tool", "Draw the selected points in orange (default)"),
  f("sel-colour-magenta", "Selected colour Magenta", "tool", "Draw the selected points in magenta (close to the pink of the Will be added preview)"),
  f("sel-colour-white", "Selected colour White", "tool", "Draw the selected points in white"),
  f("sel-colour-lime", "Selected colour Lime", "tool", "Draw the selected points in bright green"),
  f("sel-commit", "Commit draft", "tool", "Make the previewed result the selection (enabled once the preview is computed)"),
  f("sel-discard", "Discard draft", "tool", "Drop the pending preview; the selection stays as it is (Esc does the same)"),
  f("sel-select-displayed", "Select displayed", "tool", "Select every displayed point (those passing the display filter), including points not drawn"),
  f("sel-invert", "Invert", "tool", "Invert the selection relative to the chosen scope"),
  f("sel-clear", "Clear selection", "tool", "Clear the whole selection; nothing is deleted"),
  f("sel-hide", "Hide selected", "tool", "Hide the selected points in the layer \"Hidden\" (not drawn, not selectable) and clear the selection; nothing is deleted and Export still includes them unless you untick the layer. Press again to show them"),
  f("sel-show-kept", "Show kept points", "tool", "Draw the selected points that protection keeps larger and bright cyan (view only; nothing is deleted)"),
  f("sel-delete-kept", "Also delete the kept points", "tool", "Delete the selected points that height protection keeps too: this operation ignores the protection slab (it comes back after Apply)"),
  f("layer-new", "New layer", "layer", "Move the selected points into a new layer with the name typed above (blank: the server names it); it is a timeline step"),
  f("layer-from-band", "New layer from protected points", "layer", "Snapshot the points inside the height-protection band into a new protected layer named Floor; the band stays on (turn on height protection first)"),
  f("layer-name", "Layer name", "layer", "Name for the next new layer, up to 40 characters"),
  f("layer-assign", "Assign selection", "layer", "Move the selected points into the layer chosen in the list (click a row first); points taken from other layers are confirmed first"),
  f("layer-release", "Release to main", "layer", "Move the selected points out of their layers back to main"),
  f("layer-set", "Set layer to selection", "layer", "While editing a layer: make the layer hold exactly the selected points (the others go to main); points taken from other layers are confirmed first. The selection stays"),
  f("export-all", "Export all layers", "layer", "Tick every layer again so the export holds the whole cloud"),
  f("export-per-layer", "One file per layer", "layer", "Write each chosen layer to its own file, named after the layer; empty layers are skipped"),
  f("export-close", "Close the export dialog", "layer", "Close this dialog after the files were prepared"),
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
  f("box-rect", "Rect", "box", "Rectangle select: drag a rectangle in a face view (ViewCube) to make the box; the depth is the whole cloud. Shift+drag narrows the current box instead. Hold R for the same. Rect stays on until you click Rect again (then Shift+drag pans); a drag that starts on a box handle still draws the rectangle while Rect is on"),
  f("box-fit-view", "Fit to view", "box", "Make the box cover everything visible in this face view, across the whole depth of the cloud"),
  f("box-fit-displayed", "Fit displayed", "box", "Make the box cover the displayed points: the active cloud narrowed by the display filter"),
  f("gizmo-snap", "Snap", "box", "Snap handle drags to the step sizes below; hold Shift for fine (x0.1) drags"),
  f("gizmo-step", "Snap step", "box", "Translation snap step in the file unit"),
  f("gizmo-angle-step", "Angle step", "box", "Rotation snap step in degrees"),
  f("poly-edit", "Edit polygon vertices", "polygon", "Edit mode: drag a vertex, click an edge to add a vertex, press Backspace over a vertex or double click it to remove it; Enter or Esc leaves edit mode"),
  f("poly-draw", "Draw polygon", "polygon", "Start drawing: click in the top view to add vertices"),
  f("poly-finish", "Close polygon", "polygon", "Close the polygon and preview (Enter)"),
  f("poly-cancel", "Cancel drawing", "polygon", "Stop drawing and restore the previous polygon (Escape)"),
  f("poly-clear", "Clear polygon", "polygon", "Remove the polygon"),
  f("poly-zmin", "Z min", "polygon", "Lower Z limit of the polygon prism; the default is unlimited"),
  f("poly-zmax", "Z max", "polygon", "Upper Z limit of the polygon prism; the default is unlimited"),
  f("poly-mode", "Polygon mode", "polygon", "Inside selects points in the prism; outside selects everything else"),
  f("cluster-pick-seed", "Pick point", "cluster", "Pick the point the cluster grows from. Pressing the Cluster tool already waits for it; press this to clear the picked point and choose another"),
  f("cluster-radius", "Link distance", "cluster", "Link distance in the file unit: two points closer than this belong to the same cluster. Too large and the cluster leaks into the floor or walls; too small and it breaks apart"),
  f("cluster-region", "Region", "cluster", "Limit the cluster search to the current box or polygon"),
  f("cluster-exclude-protected", "Exclude protected", "cluster", "Do not let the cluster grow through height-protected points"),
  f("cluster-max-points", "Max points", "cluster", "Stop and report if the cluster grows past this many points"),
  f("cluster-cancel", "Cancel", "cluster", "Cancel the running cluster computation"),
  f("sparse-radius", "Radius", "sparse", "Cube edge in the file unit used to count neighbours; empty derives it from the point spacing"),
  f("sparse-min", "Min neighbours", "sparse", "A point with fewer than this many points around it (itself included) is selected"),
  f("sparse-region", "Region", "sparse", "Limit the search to the current box or polygon"),
  f("sparse-exclude-protected", "Exclude protected", "sparse", "Never select height-protected points"),
  ...AX.flatMap((a) =>
    (["min", "max"] as const).flatMap((s) => {
      const lo = s === "min";
      const U = up(a);
      return [
        f(`filter-${a}-${s}`, `${U} ${s}`, "filter", `${lo ? "Lowest" : "Highest"} displayed ${U} (inclusive); type a value and press Enter, Esc undoes. Points outside are hidden, not deleted`),
        f(`filter-${a}-${s}-grip`, `${U} ${s} grip`, "filter", `Drag along the edge to set the ${lo ? "lowest" : "highest"} displayed ${U}; arrow keys nudge, Shift is finer, Home and End jump to the cloud bounds`),
        f(`filter-${a}-${s}-reset`, `${U} ${s} reset`, "filter", `Put the ${lo ? "lowest" : "highest"} displayed ${U} back to the cloud's ${lo ? "minimum" : "maximum"}, so this side hides nothing`),
        f(`filter-${a}-${s}-toggle`, `${U} ${s} collapse`, "filter", `Collapse or expand the ${U} ${s} filter box; a collapsed box keeps its filter, and its chip is highlighted while it hides points`),
      ];
    }),
  ),
  f("filter-reset-all", "Reset filters", "filter", "Put all six display filter sides back to the whole cloud (nothing hidden)"),
  f("prot-enabled", "Global protection", "protection", "Protect every point whose Z is inside the interval from deletion; off by default"),
  f("prot-min", "Protect min Z", "protection", "Lower Z of the protected slab (inclusive)"),
  f("prot-max", "Protect max Z", "protection", "Upper Z of the protected slab (inclusive)"),
  f("prot-pick-floor", "Pick floor point", "protection", "Click a floor point in the view: global protection is set to its Z plus or minus the half thickness"),
  f("prot-floor-t", "Floor half thickness", "protection", "Half thickness of the slab made by Pick floor point, in the file unit"),
  f("prot-mode", "Operation protection", "protection", "Inherit uses the global slab; add a local slab for one operation; or override the global slab"),
  f("prot-local-min", "Local min Z", "protection", "Lower Z of the local protected slab for this operation"),
  f("prot-local-max", "Local max Z", "protection", "Upper Z of the local protected slab for this operation"),
  f("prot-tilt-x", "Tilt about X", "protection", "Tilt of the protected slab about the X axis in degrees, -60 to 60; drag the blue X ring on the canvas for the same"),
  f("prot-tilt-y", "Tilt about Y", "protection", "Tilt of the protected slab about the Y axis in degrees, -60 to 60; drag the blue Y ring on the canvas for the same"),
  f("prot-level", "Level slab", "protection", "Make the protected slab horizontal again (tilt 0 and 0); the Min and Max numbers keep their values"),
  f("prot-ack", "Acknowledge override", "protection", "Confirm that this operation ignores the global protection"),
  f("step-edit-shape", "Edit shape", "history", "Reopen the highlighted step as a live selection of its own tool and numbers: clears the selection first, changes no history, and applying it afterwards adds a new step"),
];
