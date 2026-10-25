import importlib.util
import pathlib
import tempfile
import unittest
import yaml

spec = importlib.util.spec_from_file_location('runtime_controller', str(pathlib.Path(__file__).with_name('controller.py')))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ControllerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.compose = self.root / 'compose.yml'
        self.compose.write_text(yaml.safe_dump({'services': {'sub2api': {
            'image': 'weishaw/sub2api:0.2.17', 'mem_limit': '600m', 'memswap_limit': '768m',
            'environment': {'DATABASE_MAX_OPEN_CONNS': '15', 'DATABASE_MAX_IDLE_CONNS': '3', 'SECRET': 'keep-me'},
            'volumes': ['./data:/app/data']}}}))
        self.original = self.compose.read_bytes()
        self.calls = []
        self.effective = {'dbMaxOpenConnections': 15, 'memoryMiB': 600}
        self.fail_apply = False
        self.controller = module.Controller(self.compose, self.root / 'state', runner=self.run_command, health=lambda: None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_command(self, args):
        import json
        self.calls.append(args)
        if args[:2] == ['docker', 'inspect']:
            return json.dumps([{'Image': 'sha256:old', 'HostConfig': {'Memory': self.effective['memoryMiB'] * 1048576, 'MemorySwap': 768 * 1048576},
                'Config': {'Env': ['DATABASE_MAX_OPEN_CONNS=' + str(self.effective['dbMaxOpenConnections'])]}, 'State': {'Running': True}}])
        if args[:2] == ['docker', 'exec']:
            return 'Sub2API 0.2.17 (commit: current)'
        if args[:2] == ['docker', 'cp']:
            pathlib.Path(args[-1]).write_text('current-binary') if args[2].startswith('sub2api:') else None
        if 'up' in args:
            if self.fail_apply and '-d' in args:
                raise RuntimeError('unhealthy')
            if '-d' in args:
                self.effective = self.controller.configured(yaml.safe_load(self.compose.read_text()))
        if args[:2] == ['docker', 'update']:
            self.effective['memoryMiB'] = int(args[args.index('--memory') + 1]) // 1048576
        return ''

    def payload(self, **values):
        return dict({'revision': self.controller.status()['revision'], 'memoryMiB': 600, 'dbMaxOpenConnections': 15, 'actor': 'operator'}, **values)

    def finish(self, payload):
        result = self.controller.start(payload)
        self.controller.worker.join(3)
        self.assertFalse(self.controller.worker.is_alive())
        return self.controller.status()

    def test_memory_only_persists_without_recreating(self):
        result = self.finish(self.payload(memoryMiB=620))
        self.assertEqual(result['lastApply']['status'], 'succeeded')
        self.assertEqual(result['effective']['memoryMiB'], 620)
        self.assertFalse(any('up' in call for call in self.calls))
        saved = yaml.safe_load(self.compose.read_text())['services']['sub2api']
        self.assertEqual(saved['environment']['SECRET'], 'keep-me')
        self.assertEqual(saved['volumes'], ['./data:/app/data'])

    def test_pool_change_recreates_and_health_failure_rolls_back(self):
        result = self.finish(self.payload(dbMaxOpenConnections=18))
        self.assertEqual(result['effective']['dbMaxOpenConnections'], 18)
        self.assertTrue(any('up' in call and '-d' in call for call in self.calls))
        self.fail_apply = True
        before = self.compose.read_bytes()
        result = self.finish(self.payload(dbMaxOpenConnections=20))
        self.assertEqual(result['lastApply']['status'], 'rolled_back')
        self.assertEqual(self.compose.read_bytes(), before)
        self.assertTrue(any(call[:2] == ['docker', 'cp'] and call[-1] == 'sub2api:/app/sub2api' for call in self.calls))

    def test_recreate_keeps_current_program_version(self):
        document = yaml.safe_load(self.compose.read_text())
        document['services']['sub2api']['image'] = 'weishaw/sub2api:0.2.15'
        self.compose.write_text(yaml.safe_dump(document))
        result = self.finish(self.payload(dbMaxOpenConnections=18))
        self.assertEqual(result['lastApply']['status'], 'succeeded')
        self.assertIn(['docker', 'pull', 'weishaw/sub2api:0.2.17'], self.calls)
        self.assertEqual(yaml.safe_load(self.compose.read_text())['services']['sub2api']['image'], 'weishaw/sub2api:0.2.17')

    def test_prepare_failure_does_not_restart_running_service(self):
        document = yaml.safe_load(self.compose.read_text())
        document['services']['sub2api']['image'] = 'weishaw/sub2api:0.2.15'
        self.compose.write_text(yaml.safe_dump(document))
        before = self.compose.read_bytes()
        runner = self.controller.runner
        def fail_pull(args):
            if args[:2] == ['docker', 'pull']: raise RuntimeError('registry unavailable')
            return runner(args)
        self.controller.runner = fail_pull
        result = self.finish(self.payload(dbMaxOpenConnections=18))
        self.assertEqual(result['lastApply']['status'], 'failed')
        self.assertEqual(self.compose.read_bytes(), before)
        self.assertFalse(any('up' in call or call[:2] == ['docker', 'update'] for call in self.calls))

    def test_external_edit_during_failure_is_preserved(self):
        def manual_change():
            self.compose.write_text('manual intervention')
            raise RuntimeError('health failed')
        self.controller.health = manual_change
        self.controller.start(self.payload(memoryMiB=610))
        self.controller.worker.join(3)
        self.assertEqual(self.controller.job['status'], 'rollback_failed')
        self.assertEqual(self.compose.read_text(), 'manual intervention')

    def test_invalid_stale_or_unknown_fields_do_not_write(self):
        for payload in [self.payload(memoryMiB=10000), self.payload(memoryMiB=True), self.payload(dbMaxOpenConnections=False), self.payload(dbMaxOpenConnections=2), self.payload(revision='0' * 64), self.payload(command='rm -rf /')]:
            with self.assertRaises(module.ControlError): self.controller.start(payload)
        self.assertEqual(self.compose.read_bytes(), self.original)

    def test_concurrent_apply_is_rejected(self):
        import threading
        gate = threading.Event()
        self.controller.health = lambda: gate.wait(2)
        self.controller.start(self.payload(memoryMiB=610))
        try:
            with self.assertRaises(module.ControlError): self.controller.start(self.payload(memoryMiB=620))
        finally:
            gate.set()
            self.controller.worker.join(3)

    def test_interrupted_apply_restores_backup(self):
        before = self.compose.read_bytes()
        self.finish(self.payload(memoryMiB=610))
        job = self.controller.job
        job['status'] = 'applying'
        self.controller.save_job()
        self.controller.recover()
        self.assertEqual(self.controller.job['status'], 'rolled_back')
        self.assertEqual(self.compose.read_bytes(), before)


if __name__ == '__main__': unittest.main()
