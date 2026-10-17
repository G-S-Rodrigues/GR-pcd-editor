import { ApiError } from "./errors";
import { getJson, postJson } from "./http";

export interface MountedEntry {
  name: string;
  type: "dir" | "file";
  kind: "pcd" | "session" | null;
  size: number;
}

export interface MountedListing {
  path: string;
  entries: MountedEntry[];
  truncated: boolean;
}

function checkRelative(path: string): void {
  const bad =
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((seg) => seg === "..");
  if (bad) throw new ApiError(0, "path_escape", "paths must stay inside the data folder");
}

export async function listMounted(path = ""): Promise<MountedListing> {
  checkRelative(path);
  return getJson<MountedListing>(`/api/mounted?path=${encodeURIComponent(path)}`);
}

export async function openMounted<T = unknown>(
  path: string,
  kind: "pcd" | "session",
  replace = false,
): Promise<T> {
  checkRelative(path);
  const url = kind === "session" ? "/api/session/open-archive" : "/api/session/open";
  return postJson<T>(url, { path, replace });
}
