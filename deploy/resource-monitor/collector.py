#!/usr/bin/env python3
"""独立于业务和 Docker API 的 Linux cgroup v1 资源采样器。"""
import argparse
import json
import os
import pathlib
import signal
import sqlite3
import sys
import time

INTERVAL = 15
RETENTION = 7 * 86400


def counters(text):
    result = {}
    for line in text.splitlines():
        parts = line.replace(":", "").split()
        if len(parts) >= 2:
            result[parts[0]] = int(parts[1])
    return result


def delta(current, previous):
    return current - previous if current >= previous else None


def disk_counters(text, devices):
    result = {}
    for line in text.splitlines():
        p = line.split()
        if len(p) >= 14 and p[2] in devices:
            result[p[2]] = [int(p[i]) for i in (3, 6, 7, 10, 12)]
    return result


def disk_rates(current, previous, elapsed):
    result = []
    for device, values in sorted(current.items()):
        read_ms = write_ms = busy = None
        old = previous.get(device)
        if old is not None and elapsed > 0:
            changes = [delta(v, o) for v, o in zip(values, old)]
            if all(v is not None for v in changes):
                reads, read_time, writes, write_time, busy_ms = changes
                read_ms = read_time / reads if reads else 0.0
                write_ms = write_time / writes if writes else 0.0
                busy = min(100.0, busy_ms / (elapsed * 10))
        result.append({"device": device, "readAwaitMs": read_ms, "writeAwaitMs": write_ms, "busyPercent": busy})
    return result


class Collector:
    def __init__(self, root=pathlib.Path("/")):
        self.root = root
        self.previous_vm = None
        self.previous_disks = {}
        self.previous_time = None
        self.page_size = os.sysconf("SC_PAGE_SIZE")

    def read(self, path):
        return (self.root / path.lstrip("/")).read_text()

    def containers(self):
        result = []
        base = self.root / "sys/fs/cgroup/memory/docker"
        for cg in sorted(base.glob("*")):
            try:
                number = lambda name: int((cg / name).read_text())
                stat = counters((cg / "memory.stat").read_text())
                used = number("memory.usage_in_bytes")
                limit = number("memory.limit_in_bytes")
                metadata = json.loads(self.read("/var/lib/docker/containers/{}/config.v2.json".format(cg.name)))
                result.append({
                    "id": cg.name, "name": metadata["Name"].lstrip("/"),
                    "usedBytes": used, "workingSetBytes": max(0, used - stat["total_inactive_file"]),
                    "rssBytes": stat["total_rss"], "cacheBytes": stat["total_cache"],
                    "swapBytes": max(0, number("memory.memsw.usage_in_bytes") - used),
                    "limitBytes": limit if limit < (1 << 60) else None,
                    "peakBytes": number("memory.max_usage_in_bytes"), "failCount": number("memory.failcnt"),
                })
            except (OSError, ValueError, KeyError):
                # 容器创建或删除与采样并发；缺失数据不伪装为零。
                continue
        return result

    def sample(self, monotonic=None):
        now = time.monotonic() if monotonic is None else monotonic
        mem = counters(self.read("/proc/meminfo"))
        vm = counters(self.read("/proc/vmstat"))
        devices = {p.name for p in (self.root / "sys/block").iterdir() if not p.name.startswith(("loop", "ram"))}
        disks = disk_counters(self.read("/proc/diskstats"), devices)
        elapsed = now - self.previous_time if self.previous_time is not None else 0
        swap_in = swap_out = None
        if self.previous_vm is not None and elapsed > 0:
            incoming = delta(vm["pswpin"], self.previous_vm["pswpin"])
            outgoing = delta(vm["pswpout"], self.previous_vm["pswpout"])
            swap_in = incoming * self.page_size / elapsed if incoming is not None else None
            swap_out = outgoing * self.page_size / elapsed if outgoing is not None else None
        host = {
            "totalBytes": mem["MemTotal"] * 1024, "availableBytes": mem["MemAvailable"] * 1024,
            "swapTotalBytes": mem["SwapTotal"] * 1024, "swapUsedBytes": (mem["SwapTotal"] - mem["SwapFree"]) * 1024,
            "swapInBytesPerSecond": swap_in, "swapOutBytesPerSecond": swap_out,
        }
        result = {"host": host, "containers": self.containers(), "disks": disk_rates(disks, self.previous_disks, elapsed)}
        self.previous_vm, self.previous_disks, self.previous_time = vm, disks, now
        return result


class Store:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), timeout=2)
        self.db.execute("PRAGMA auto_vacuum=INCREMENTAL")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("PRAGMA journal_size_limit=8388608")
        self.db.execute("PRAGMA max_page_count=65536")
        self.db.execute("CREATE TABLE IF NOT EXISTS samples (at INTEGER PRIMARY KEY, boot TEXT NOT NULL, host TEXT NOT NULL, containers TEXT NOT NULL, disks TEXT NOT NULL)")
        self.writes = 0

    def write(self, at, boot, sample):
        encode = lambda key: json.dumps(sample[key], separators=(",", ":"), allow_nan=False)
        with self.db:
            self.db.execute("INSERT INTO samples VALUES (?, ?, ?, ?, ?)", (at, boot, encode("host"), encode("containers"), encode("disks")))
            self.db.execute("DELETE FROM samples WHERE at < ?", (at - RETENTION,))
        self.writes += 1
        if self.writes % 240 == 0:
            self.db.execute("PRAGMA incremental_vacuum(100)")
            self.db.execute("PRAGMA wal_checkpoint(PASSIVE)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="/var/lib/sub2api-resource-monitor/metrics.sqlite3")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    os.umask(0o027)
    collector, store = Collector(), Store(pathlib.Path(args.database))
    boot = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    running = [True]
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: running.__setitem__(0, False))
    while running[0]:
        started = time.monotonic()
        try:
            store.write(int(time.time()), boot, collector.sample(started))
        except Exception as error:
            print("resource sample failed: {}".format(type(error).__name__), file=sys.stderr, flush=True)
            if args.once:
                raise
        if args.once:
            return
        deadline = started + INTERVAL
        while running[0] and time.monotonic() < deadline:
            time.sleep(min(1, max(0, deadline - time.monotonic())))


if __name__ == "__main__":
    main()
