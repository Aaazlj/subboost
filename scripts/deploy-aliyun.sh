#!/bin/sh
set -eu

cd /root/subboost
if [ "${SSH_ORIGINAL_COMMAND:-}" = deploy-config ]; then
  config_dir=$(mktemp -d /tmp/subboost-config.XXXXXX)
  trap 'rm -rf "$config_dir"' EXIT
  cat > "$config_dir/config.tar"
  tar -tf "$config_dir/config.tar" | while IFS= read -r name; do
    case "$name" in
      docker-compose.yml|scripts/|scripts/deploy-aliyun.sh) ;;
      *) echo "Unexpected deployment file: $name" >&2; exit 1 ;;
    esac
  done
  tar -xf "$config_dir/config.tar" -C "$config_dir" --no-same-owner
  [ -f "$config_dir/docker-compose.yml" ] && [ -f "$config_dir/scripts/deploy-aliyun.sh" ]
  install -m 644 "$config_dir/docker-compose.yml" /root/subboost/docker-compose.yml
  install -m 700 "$config_dir/scripts/deploy-aliyun.sh" /root/subboost/scripts/deploy-aliyun.sh
  install -m 700 "$config_dir/scripts/deploy-aliyun.sh" /root/subboost/deploy-aliyun.sh
  exit 0
fi

IFS=' ' read -r action IMAGE_TAG GHCR_USER <<EOF
${SSH_ORIGINAL_COMMAND:-}
EOF
[ "$action" = deploy ] && [ -n "$GHCR_USER" ] || { echo "Only the deploy command is allowed" >&2; exit 1; }
case "$IMAGE_TAG" in
  *[!0-9a-f]*|"") echo "Invalid image tag" >&2; exit 1 ;;
esac
[ "${#IMAGE_TAG}" -eq 40 ] || { echo "Invalid image tag" >&2; exit 1; }
case "$GHCR_USER" in
  *[!A-Za-z0-9-]*|"") echo "Invalid GHCR username" >&2; exit 1 ;;
esac
export SUBBOOST_IMAGE="ghcr.io/aaazlj/subboost:$IMAGE_TAG"
export DOCKER_CONFIG=$(mktemp -d /tmp/subboost-ghcr.XXXXXX)

trap 'docker logout ghcr.io >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"' EXIT
docker login ghcr.io --username "$GHCR_USER" --password-stdin
docker compose pull app

container=$(docker compose ps -q app)
if [ -n "$container" ]; then
  docker exec -i "$container" python3 - <<'PY'
import json
import pathlib
import subprocess

state = pathlib.Path("/data/vpngate_tunnels.json")
script = "/app/local/src/lib/vpngate/tunnel_daemon.py"
for tunnel in json.loads(state.read_text()) if state.exists() else []:
    result = subprocess.run(
        ["python3", script, "stop", "--id", tunnel["id"]],
        check=True,
        capture_output=True,
        text=True,
    )
    if not json.loads(result.stdout).get("success"):
        raise SystemExit(f"Failed to stop tunnel {tunnel['id']}")
PY
fi

docker compose up -d --no-build app
attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl -fsS --max-time 3 "http://127.0.0.1:${SUBBOOST_PORT:-38921}/admin" >/dev/null; then
    docker compose ps app
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done
docker compose logs --tail=100 app >&2
exit 1
