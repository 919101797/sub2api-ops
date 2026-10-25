#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请使用 root 安装' >&2; exit 1; }
python3 -c 'import yaml'
docker compose version >/dev/null
[[ -f /opt/sub2api/compose.yml ]] || { echo '未找到 Sub2API 编排' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 0755 /usr/local/lib/sub2api-runtime-control
install -m 0644 "$source_dir/controller.py" /usr/local/lib/sub2api-runtime-control/controller.py
install -m 0644 "$source_dir/sub2api-runtime-control.service" /etc/systemd/system/sub2api-runtime-control.service
systemctl daemon-reload
systemctl enable sub2api-runtime-control.service
systemctl restart sub2api-runtime-control.service
