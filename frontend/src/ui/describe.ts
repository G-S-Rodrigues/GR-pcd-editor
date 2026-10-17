import { FIELD_SPECS, type FieldGroup } from "./fields";

export interface ControlDescriptor {
  id: string;
  label: string;
  group: "file" | "edit" | "view" | "pivot" | "display" | FieldGroup;
}

/** Every control the shell builds; the DOM binders and the tooltip test both read this list. */
export function describeControls(): ControlDescriptor[] {
  return [
    { id: "open-file", label: "Open from this computer", group: "file" },
    { id: "save-session", label: "Save session", group: "file" },
    { id: "export", label: "Export", group: "file" },
    { id: "undo", label: "Undo", group: "edit" },
    { id: "redo", label: "Redo", group: "edit" },
    { id: "preview", label: "Preview", group: "edit" },
    { id: "apply", label: "Apply", group: "edit" },
    ...(["top", "bottom", "front", "back", "left", "right"] as const).map((p) => ({ id: `cube-${p}`, label: `Cube ${p}`, group: "view" as const })),
    { id: "view-perspective", label: "Perspective", group: "view" },
    { id: "fit-cloud", label: "Fit cloud", group: "view" },
    { id: "pivot-reset", label: "Reset pivot", group: "pivot" },
    { id: "pivot-pick", label: "Pick pivot", group: "pivot" },
    { id: "pivot-x", label: "Pivot X", group: "pivot" },
    { id: "pivot-y", label: "Pivot Y", group: "pivot" },
    { id: "pivot-z", label: "Pivot Z", group: "pivot" },
    { id: "pivot-set", label: "Set pivot", group: "pivot" },
    { id: "colour-mode", label: "Colour", group: "display" },
    { id: "point-size", label: "Point size", group: "display" },
    { id: "point-size-auto", label: "Auto size", group: "display" },
    { id: "budget", label: "Render budget", group: "display" },
    { id: "help", label: "Controls help", group: "display" },
    { id: "compare-original", label: "Original", group: "view" },
    { id: "compare-edited", label: "Edited", group: "view" },
    { id: "compare-overlay", label: "Overlay", group: "view" },
    { id: "compare-split", label: "Split", group: "view" },
    { id: "compare-hold-original", label: "Hold original", group: "view" },
    { id: "overlay-opacity", label: "Overlay opacity", group: "view" },
    { id: "upload-cancel", label: "Cancel upload", group: "file" },
    { id: "export-scope", label: "Export scope", group: "file" },
    { id: "export-format", label: "Export format", group: "file" },
    { id: "export-go", label: "Export now", group: "file" },
    { id: "export-cancel", label: "Cancel export", group: "file" },
    ...FIELD_SPECS.map(({ id, label, group }) => ({ id, label, group })),
  ];
}
