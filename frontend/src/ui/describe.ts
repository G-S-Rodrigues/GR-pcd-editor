export interface ControlDescriptor {
  id: string;
  label: string;
  group: "file" | "edit" | "view" | "pivot" | "display";
}

/** Every control the shell builds; the DOM binders and the tooltip test both read this list. */
export function describeControls(): ControlDescriptor[] {
  return [
    { id: "open-file", label: "Open from this computer", group: "file" },
    { id: "open-mounted", label: "Open from mounted folder", group: "file" },
    { id: "save-session", label: "Save session", group: "file" },
    { id: "export", label: "Export", group: "file" },
    { id: "undo", label: "Undo", group: "edit" },
    { id: "redo", label: "Redo", group: "edit" },
    { id: "preview", label: "Preview", group: "edit" },
    { id: "apply", label: "Apply", group: "edit" },
    { id: "view-top", label: "Top", group: "view" },
    { id: "view-bottom", label: "Bottom", group: "view" },
    { id: "view-front", label: "Front", group: "view" },
    { id: "view-back", label: "Back", group: "view" },
    { id: "view-left", label: "Left", group: "view" },
    { id: "view-right", label: "Right", group: "view" },
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
    { id: "budget", label: "Render budget", group: "display" },
    { id: "help", label: "Controls help", group: "display" },
    { id: "mounted-up", label: "Up one folder", group: "file" },
    { id: "mounted-close", label: "Close", group: "file" },
  ];
}
