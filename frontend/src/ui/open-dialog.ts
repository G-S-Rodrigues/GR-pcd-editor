import { type MountedListing, listMounted } from "../files/mounted";
import { control } from "./controls";
import { h } from "./dom";

export interface MountedChoice {
  path: string;
  kind: "pcd" | "session";
}

/** Modal browser for the read-only mounted folder; it is not an upload. */
let shown: ((c: (m: MountedChoice) => void, e: (m: string) => void) => void) | null = null;

export function openMountedDialog(onChoose: (c: MountedChoice) => void, onError: (m: string) => void): void {
  if (!shown) shown = buildDialog();
  shown(onChoose, onError);
}

function buildDialog(): (c: (m: MountedChoice) => void, e: (m: string) => void) => void {
  let current = "";
  let onChoose: (c: MountedChoice) => void = () => undefined;
  let onError: (m: string) => void = () => undefined;
  const title = h("h3", {
    text: "Mounted folder (/data on the host folder you launched with) — not an upload",
  });
  const path = h("div", { class: "muted", "data-testid": "mounted-path" });
  const list = h("ul", { id: "mounted-list" });
  const dialog = h("dialog", { id: "mounted-dialog" });
  const close = () => dialog.close();
  const up = control(
    "button",
    {
      id: "mounted-up",
      onclick: () => {
        current = current.split("/").slice(0, -1).join("/");
        void load();
      },
    },
    "Up",
  );
  dialog.append(title, path, up, list, control("button", { id: "mounted-close", onclick: close }, "Close"));

  async function load() {
    let l: MountedListing;
    try {
      l = await listMounted(current);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not list the mounted folder");
      return;
    }
    path.textContent = `/data/${current}`;
    up.disabled = current === "";
    list.replaceChildren(
      ...(l.entries.length === 0 ? [h("li", { text: "(empty)" })] : []),
      ...l.entries
        .filter((e) => e.type === "dir" || e.kind !== null)
        .map((e) =>
          h(
            "li",
            {
              title: e.type === "dir" ? "Open folder" : "Open this file",
              onclick: () => {
                const p = current ? `${current}/${e.name}` : e.name;
                if (e.type === "dir") {
                  current = p;
                  void load();
                } else if (e.kind) {
                  close();
                  onChoose({ path: p, kind: e.kind });
                }
              },
            },
            h("span", { text: e.type === "dir" ? `${e.name}/` : e.name }),
            h("span", { class: "muted", text: e.type === "dir" ? "" : `${e.size.toLocaleString("en-US")} bytes` }),
          ),
        ),
      ...(l.truncated ? [h("li", { text: "(listing truncated)" })] : []),
    );
  }
  document.body.append(dialog);
  return (choose, error) => {
    onChoose = choose;
    onError = error;
    current = "";
    dialog.showModal();
    void load();
  };
}
