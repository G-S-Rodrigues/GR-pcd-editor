# Testing

The only working Part 1 check is the local bootstrap contract:

```sh
bash scripts/check-bootstrap-contract.sh
```

Before the Part 1 commit, stage only the documented bootstrap files and run:

```sh
bash scripts/check-bootstrap-contract.sh --staged
```

Part 2 will add the stable Docker Compose interfaces below; they are pending
and must not be treated as available now:

```sh
docker compose -f docker/compose.yaml --profile checks build verify lint
docker compose -f docker/compose.yaml --profile checks run --rm verify
docker compose -f docker/compose.yaml --profile checks run --rm lint
```
