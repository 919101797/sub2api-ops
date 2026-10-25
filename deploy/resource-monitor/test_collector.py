import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("collector", pathlib.Path(__file__).with_name("collector.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorTest(unittest.TestCase):
    def test_independent_sample_and_rates(self):
        """场景-011-01/02：没有网络及 Docker API，仍采样并计算差值。"""
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            def put(path, text):
                p = root / path
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text)
            put("proc/meminfo", "MemTotal: 2000 kB\nMemAvailable: 500 kB\nSwapTotal: 4000 kB\nSwapFree: 3000 kB\n")
            put("proc/vmstat", "pswpin 10\npswpout 20\n")
            put("proc/diskstats", "8 0 vda 10 0 0 100 20 0 0 200 0 150 0\n")
            (root / "sys/block/vda").mkdir(parents=True)
            cg = root / "sys/fs/cgroup/memory/docker/abc"
            cg.mkdir(parents=True)
            for name, value in {"memory.usage_in_bytes": 1000, "memory.limit_in_bytes": 2**63, "memory.memsw.usage_in_bytes": 1100, "memory.max_usage_in_bytes": 1200, "memory.failcnt": 3}.items():
                put(str(cg.relative_to(root) / name), str(value))
            put(str(cg.relative_to(root) / "memory.stat"), "total_inactive_file 200\ntotal_rss 400\ntotal_cache 600\n")
            put("var/lib/docker/containers/abc/config.v2.json", json.dumps({"Name": "/sub2api", "Config": {"Env": ["SECRET=hidden"]}}))
            c = collector.Collector(root)
            first = c.sample(100)
            self.assertIsNone(first["host"]["swapInBytesPerSecond"])
            self.assertIsNone(first["disks"][0]["readAwaitMs"])
            self.assertEqual(first["containers"][0]["workingSetBytes"], 800)
            self.assertIsNone(first["containers"][0]["limitBytes"])
            self.assertNotIn("SECRET", json.dumps(first))
            put("proc/vmstat", "pswpin 25\npswpout 50\n")
            put("proc/diskstats", "8 0 vda 12 0 0 120 23 0 0 260 0 300 0\n")
            second = c.sample(115)
            self.assertEqual(second["host"]["swapInBytesPerSecond"], c.page_size)
            self.assertEqual(second["disks"][0]["readAwaitMs"], 10)
            self.assertEqual(second["disks"][0]["writeAwaitMs"], 20)
            self.assertEqual(second["disks"][0]["busyPercent"], 1)
            put("proc/vmstat", "pswpin 0\npswpout 0\n")
            self.assertIsNone(c.sample(130)["host"]["swapOutBytesPerSecond"])

    def test_retention(self):
        """场景-011-03：删除超过七天的样本，保留边界。"""
        with tempfile.TemporaryDirectory() as directory:
            store = collector.Store(pathlib.Path(directory) / "metrics.sqlite3")
            sample = {"host": {}, "containers": [], "disks": []}
            store.write(1, "boot", sample)
            store.write(2, "boot", sample)
            store.write(collector.RETENTION + 2, "boot", sample)
            self.assertEqual([r[0] for r in store.db.execute("SELECT at FROM samples ORDER BY at")], [2, collector.RETENTION + 2])
            store.db.close()


if __name__ == "__main__":
    unittest.main()
