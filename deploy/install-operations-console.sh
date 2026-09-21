#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 运行此脚本" >&2
  exit 1
fi

BUILD_OPTION=--no-build
if [[ "${1:-}" == "--no-build" ]]; then
  BUILD_OPTION=--no-build
  shift
fi
if [[ "$#" -ne 0 ]]; then
  echo "用法：$0 [--no-build]" >&2
  exit 1
fi

SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIRECTORY=$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)
ENV_FILE="$PROJECT_DIRECTORY/.env"
NGINX_TEMPLATE="$SCRIPT_DIRECTORY/nginx-sub2api-prompt-audit.conf"
NGINX_SNIPPET=${NGINX_SNIPPET:-/etc/nginx/snippets/sub2api-prompt-audit.conf}

for command in curl docker nginx python3 systemctl; do
  command -v "$command" >/dev/null 2>&1 || { echo "缺少命令：$command" >&2; exit 1; }
done
docker compose version >/dev/null
[[ -f "$ENV_FILE" ]] || { echo "缺少 $ENV_FILE，请先从 .env.example 创建并填写" >&2; exit 1; }
[[ -f "$NGINX_TEMPLATE" ]] || { echo "缺少 Nginx 模板：$NGINX_TEMPLATE" >&2; exit 1; }

SUB2API_IMAGE_REFERENCE=$(docker inspect sub2api --format '{{.Config.Image}}' 2>/dev/null) \
  || { echo "未找到名为 sub2api 的运行容器" >&2; exit 1; }
case "$SUB2API_IMAGE_REFERENCE" in
  weishaw/sub2api:*|weishaw/sub2api@sha256:*|docker.io/weishaw/sub2api:*|docker.io/weishaw/sub2api@sha256:*|ghcr.io/wei-shaw/sub2api:*|ghcr.io/wei-shaw/sub2api@sha256:*) ;;
  *)
    echo "拒绝部署：Sub2API 必须使用官方镜像，当前为 $SUB2API_IMAGE_REFERENCE" >&2
    exit 1
    ;;
esac
SUB2API_IMAGE_ID=$(docker inspect sub2api --format '{{.Image}}')
SUB2API_REPO_DIGESTS=$(docker image inspect "$SUB2API_IMAGE_ID" --format '{{range .RepoDigests}}{{println .}}{{end}}')
if ! grep -Eq '^(weishaw/sub2api|docker\.io/weishaw/sub2api|ghcr\.io/wei-shaw/sub2api)@sha256:' <<<"$SUB2API_REPO_DIGESTS"; then
  echo "拒绝部署：当前 Sub2API 镜像没有官方仓库 RepoDigest，可能是本地派生镜像" >&2
  exit 1
fi

read_env() {
  python3 - "$ENV_FILE" "$1" <<'PY'
from pathlib import Path
import sys

path, key = Path(sys.argv[1]), sys.argv[2]
for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    name, value = line.split('=', 1)
    if name.strip() != key:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    print(value)
    break
PY
}

CAPTURE_SECRET=$(read_env PROMPT_CAPTURE_SECRET)
OPS_HOST_PORT=$(read_env OPS_HOST_PORT)
OPS_HOST_PORT=${OPS_HOST_PORT:-3002}
WS_RELAY_HOST_PORT=$(read_env WS_RELAY_HOST_PORT)
WS_RELAY_HOST_PORT=${WS_RELAY_HOST_PORT:-3003}

[[ ${#CAPTURE_SECRET} -ge 32 ]] || { echo "PROMPT_CAPTURE_SECRET 至少需要 32 个字符" >&2; exit 1; }
[[ "$OPS_HOST_PORT" =~ ^[0-9]+$ ]] && (( OPS_HOST_PORT >= 1 && OPS_HOST_PORT <= 65535 )) \
  || { echo "OPS_HOST_PORT 无效" >&2; exit 1; }
[[ "$WS_RELAY_HOST_PORT" =~ ^[0-9]+$ ]] && (( WS_RELAY_HOST_PORT >= 1 && WS_RELAY_HOST_PORT <= 65535 )) \
  || { echo "WS_RELAY_HOST_PORT 无效" >&2; exit 1; }

services_healthy() {
  curl --fail --silent "http://127.0.0.1:${OPS_HOST_PORT}/health" >/dev/null \
    && curl --fail --silent "http://127.0.0.1:${WS_RELAY_HOST_PORT}/health" >/dev/null \
    && docker exec sub2api-operations-console node -e "require('node:dns').promises.lookup('sub2api').catch(() => process.exit(1))" \
    && docker exec sub2api-ws-audit-relay node -e "require('node:dns').promises.lookup('sub2api').catch(() => process.exit(1))"
}

wait_for_services() {
  local attempts=${1:-60}
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if services_healthy; then
      return 0
    fi
    sleep 1
  done
  return 1
}

prune_old_operations_images() {
  local repository=sub2api-operations-console
  local retention=3
  local reference image_id
  local -a version_references=()
  local -a all_references=()

  mapfile -t version_references < <(
    docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}' \
      | grep -E "^${repository}:[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$" \
      | sort -uVr
  )
  mapfile -t all_references < <(
    docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}' \
      | grep -v ':<none>$' \
      | sort -u
  )

  if (( ${#all_references[@]} <= retention )); then
    echo "Ops 镜像无需清理：当前 ${#all_references[@]} 个版本"
    return 0
  fi

  for reference in "${all_references[@]}"; do
    if printf '%s\n' "${version_references[@]:0:retention}" | grep -Fxq "$reference"; then
      continue
    fi
    image_id=$(docker image inspect "$reference" --format '{{.Id}}' 2>/dev/null) || continue
    if [[ -n "$(docker ps -aq --filter "ancestor=$image_id")" ]]; then
      echo "跳过仍被容器引用的 Ops 镜像：$reference"
      continue
    fi
    echo "逐个删除旧 Ops 镜像：$reference"
    if ! docker image rm "$reference"; then
      echo "删除 $reference 失败，停止后续镜像清理" >&2
      return 0
    fi
    sleep 2
    if ! wait_for_services 30; then
      echo "删除 $reference 后服务健康检查失败，已停止镜像清理" >&2
      return 1
    fi
  done
}

install -d -o 1000 -g 1000 -m 0700 "$PROJECT_DIRECTORY/data/prompt-media" "$PROJECT_DIRECTORY/data/ws-audit-outbox"
chown 1000:1000 "$PROJECT_DIRECTORY/config.json"
chmod 0600 "$PROJECT_DIRECTORY/config.json" "$ENV_FILE"

cd "$PROJECT_DIRECTORY"
docker compose up -d "$BUILD_OPTION"

wait_for_services 60 || { echo "运维控制台或 WS 审计 Relay 未通过健康检查" >&2; exit 1; }

candidate=$(mktemp)
backup="${NGINX_SNIPPET}.previous"
trap 'rm -f "$candidate"' EXIT
python3 - "$NGINX_TEMPLATE" "$candidate" "$CAPTURE_SECRET" "$WS_RELAY_HOST_PORT" <<'PY'
from pathlib import Path
import sys

source, destination, secret, relay_port = map(str, sys.argv[1:])
text = Path(source).read_text()
if text.count('__CAPTURE_SECRET__') != 1 or text.count('__WS_RELAY_HOST_PORT__') != 1:
    raise SystemExit('Nginx template placeholders are invalid')
text = text.replace('__CAPTURE_SECRET__', secret).replace('__WS_RELAY_HOST_PORT__', relay_port)
Path(destination).write_text(text)
PY

install -d -m 0755 "$(dirname -- "$NGINX_SNIPPET")"
if [[ -f "$NGINX_SNIPPET" ]]; then
  cp -a "$NGINX_SNIPPET" "$backup"
fi
install -o root -g root -m 0640 "$candidate" "$NGINX_SNIPPET"
if ! nginx -t; then
  if [[ -f "$backup" ]]; then
    cp -a "$backup" "$NGINX_SNIPPET"
  else
    rm -f "$NGINX_SNIPPET"
  fi
  echo "Nginx 校验失败，已恢复原配置" >&2
  exit 1
fi
systemctl reload nginx

prune_old_operations_images

docker compose ps
echo "Sub2API 运维控制台和 WS 审计 Relay 已部署完成"
