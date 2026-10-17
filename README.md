# GR PCD Editor

GR PCD Editor is a Linux-first local application for reviewing and cleaning
point-cloud (`.pcd`) maps. The application is under construction; the launcher and
container stack described below work now.

## Prerequisites

- Linux
- Docker Engine
- Docker Compose v2

## Running

Clone the repository and run:

```sh
./gr-pcd-visualizer.sh                      # data folder = current directory, port 8080
./gr-pcd-visualizer.sh --data-dir "/home/user/PCD maps" --port 8081
./gr-pcd-visualizer.sh --rebuild            # rebuild the image, keep work data
./gr-pcd-visualizer.sh --no-browser         # do not open a browser
./gr-pcd-visualizer.sh --stop               # stop; work data is kept
```

The launcher builds the image on first use, waits up to 120 s for the app to
report healthy (override with `GR_PCD_WAIT_TIMEOUT=<seconds>`), then prints
`GR PCD Editor is ready: http://localhost:<port>` and opens your browser. It
never prints that line before the health check passes. The server listens on
`127.0.0.1` only. `--stop` stops this project's container without deleting
exports or the persistent `work` volume.

One instance per checkout. Running the launcher again with the same settings
reuses the running app. Different `--data-dir`, `--port` or user is refused
(exit 5); run `./gr-pcd-visualizer.sh --stop` first. `COMPOSE_PROJECT_NAME`
selects a separate instance.

The container runs as your user id, so it can read the data folder you can
read (supplementary groups are not passed). If you are root, it runs as uid
10001 and warns. A `work` volume created by an older image is owned by uid
10001; if the app then reports the work folder is not writable, remove it
yourself with `docker volume rm gr-pcd-visualizer_work` (this deletes
uploads and session working data; the launcher never does it).

| Exit | Meaning |
|---|---|
| 0 | ready / stopped |
| 1 | startup failed or health timed out (logs printed) |
| 2 | bad flag, port or data directory (a missing directory is never created) |
| 3 | Docker CLI, Compose v2, daemon or local context missing |
| 4 | port in use |
| 5 | running instance has different settings |
| 130 | interrupted (the server may still run; use `--stop`) |

## Files, exports, and troubleshooting

**Open** takes a PCD or a saved session (`.pcdsession`) from the browser's
file picker or by drag-and-drop, from any folder the browser can read. The file
is uploaded only to this loopback app, with progress and a Cancel while bytes
are being sent. A separate mounted-folder browser lists only the launcher's data
folder (shown as `/data`, read-only, relative paths only); symlinks that leave
that folder are hidden and rejected. A replacement import never clears the
current session until it succeeds, and unsaved edits need an explicit replace.

**Export PCD** downloads `<original>_cleaned.pcd` and **Save session**
downloads `<original>_session_v1.pcdsession` (`v1` is the session format
version). Both are browser downloads: the browser or operating system selects
the destination and may show a save dialog, the app never overwrites the
original path, and "server finished" does not prove "browser saved". The
original input PCD is never modified.

Temporary uploads, exports and session archives live in the `work` volume and
are removed on startup and after one hour (never the live session's data).
Files above the size limit (16 GiB by default, `GR_PCD_MAX_SOURCE_BYTES`) fail
with a message naming the limit; "storage full" means the work volume lacks
space (a reserve of `GR_PCD_UPLOAD_RESERVE_BYTES`, 256 MiB, is kept free).
`/api` answers only to `localhost`, `127.0.0.1` and `[::1]` on the configured
port (`GR_PCD_PUBLIC_PORT`, set by the launcher from the chosen port); other
Host or Origin values are refused.

If the folder browser reports `mount_unreadable`, make the data folder readable
by the user id the launcher runs the app as.

A Docker named volume `work` holds uploads, caches and session working data
and survives stop and rebuild. Unsaved in-memory editing state is lost when the
container stops; downloads and the mounted folder are never removed.

If Docker, Compose, the Docker daemon, the data folder, or the requested port
is unavailable, the launcher explains the corrective action and
exit without claiming success.

## Verification

These Linux commands work now:

```sh
docker compose -f docker/compose.yaml --profile checks build verify lint
docker compose -f docker/compose.yaml --profile checks run --rm verify
docker compose -f docker/compose.yaml --profile checks run --rm lint
```

The container tier (needs Docker) and the bootstrap contract:

```sh
bash tests/container/test_compose.sh
bash tests/launcher/test_launcher.sh          # stub docker, no daemon
bash tests/launcher/test_launcher_smoke.sh    # real Docker, port 18081
bash scripts/check-bootstrap-contract.sh
```

## Point cloud loaded

Part 6 will add a screenshot here showing a **synthetic or redistribution-
cleared** point cloud loaded in the editor, with descriptive alt text and a
caption. It will never use `unitree_slam_downloaded_via_UI.pcd`.
