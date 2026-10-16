# GR PCD Editor

GR PCD Editor is a Linux-first local application for reviewing and cleaning
point-cloud (`.pcd`) maps. The application is not implemented yet; these are
the intended entry points for the forthcoming Docker-based release.

## Prerequisites

- Linux
- Docker Engine
- Docker Compose v2

## Running (forthcoming)

After the launcher and container configuration arrive in later parts, clone
the repository and run:

```sh
./gr-pcd-visualizer.sh
```

Subsequent runs will reuse an existing image when possible. The future
launcher will also support selecting a mounted folder and port:

```sh
./gr-pcd-visualizer.sh --data-dir "/home/user/PCD maps" --port 8081
```

The app will print its localhost URL. `--stop` will stop this project's
containers without deleting exports or persistent working data.

## Files, exports, and troubleshooting

The planned **Open** action accepts a browser-selected PCD from any permitted
host folder. A separately labelled mounted-folder browser will read only the
configured data directory. Exported PCDs and saved sessions are browser
downloads: the browser or operating system selects the destination and may
show a save dialog. The original input PCD is never modified.

If Docker, Compose, the Docker daemon, the data folder, or the requested port
is unavailable, the future launcher will explain the corrective action and
exit without claiming success.

## Verification (forthcoming)

Later parts will provide these Linux commands:

```sh
docker compose -f docker/compose.yaml --profile checks build verify lint
docker compose -f docker/compose.yaml --profile checks run --rm verify
docker compose -f docker/compose.yaml --profile checks run --rm lint
```

The current bootstrap contract can be run locally with:

```sh
bash scripts/check-bootstrap-contract.sh
```

## Point cloud loaded

Part 6 will add a screenshot here showing a **synthetic or redistribution-
cleared** point cloud loaded in the editor, with descriptive alt text and a
caption. It will never use `unitree_slam_downloaded_via_UI.pcd`.
