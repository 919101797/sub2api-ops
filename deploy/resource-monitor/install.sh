#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请使用 root 安装' >&2; exit 1; }
[[ -d /sys/fs/cgroup/memory/docker ]] || { echo '此采样器要求生产机的 Docker cgroup v1 布局' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 0755 /usr/local/lib/sub2api-resource-monitor
install -m 0644 "$source_dir/collector.py" /usr/local/lib/sub2api-resource-monitor/collector.py
install -m 0644 "$source_dir/sub2api-resource-monitor.service" /etc/systemd/system/sub2api-resource-monitor.service
systemctl daemon-reload
systemctl enable --now sub2api-resource-monitor.service
