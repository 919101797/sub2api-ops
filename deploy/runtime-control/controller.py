#!/usr/bin/env python3
"""仅通过本机 Unix socket 管理 Sub2API 的两个资源参数。Python 3.6+。"""
import datetime
import hashlib
import http.server
import json
import os
import pathlib
import re
import socketserver
import subprocess
import threading
import time
import urllib.request
import uuid

import yaml

MIB = 1048576


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class ControlError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def command(args):
    return subprocess.check_output(args, stderr=subprocess.STDOUT, timeout=150).decode('utf-8', 'replace')


def healthy():
    for _ in range(45):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3001/health', timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('Sub2API health timeout')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def memory_bytes(value):
    match = re.fullmatch(r'(\d+)([kmg]?)b?', str(value).lower())
    if not match:
        raise ControlError('现有内存配置无法识别', 503)
    return int(match[1]) * {'': 1, 'k': 1024, 'm': MIB, 'g': 1024 * MIB}[match[2]]


def environment(service):
    env = service.get('environment', {})
    if not isinstance(env, dict):
        raise ControlError('Sub2API environment 必须使用键值格式', 503)
    return env


def atomic(path, raw, mode=0o600):
    target = pathlib.Path(path)
    temporary = target.with_name(target.name + '.tmp')
    original = target.stat() if target.exists() else None
    with open(str(temporary), 'wb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(str(temporary), original.st_mode & 0o777 if original else mode)
    if original and os.geteuid() == 0:
        os.chown(str(temporary), original.st_uid, original.st_gid)
    os.replace(str(temporary), str(target))
    fd = os.open(str(target.parent), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Controller:
    def __init__(self, compose, state, runner=command, health=healthy):
        self.compose = pathlib.Path(compose)
        self.state = pathlib.Path(state)
        self.state.mkdir(parents=True, exist_ok=True)
        self.backups = self.state / 'backups'
        self.backups.mkdir(mode=0o700, exist_ok=True)
        self.runner, self.health = runner, health
        self.lock = threading.RLock()
        self.worker = None
        job_file = self.state / 'job.json'
        self.job = json.loads(job_file.read_text()) if job_file.exists() else None

    @staticmethod
    def configured(document):
        service = document['services']['sub2api']
        return {'dbMaxOpenConnections': int(environment(service)['DATABASE_MAX_OPEN_CONNS']),
                'memoryMiB': memory_bytes(service['mem_limit']) // MIB}

    def inspect(self):
        return json.loads(self.runner(['docker', 'inspect', 'sub2api']))[0]

    def effective(self):
        container = self.inspect()
        if not container['State']['Running']:
            return None
        env = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
        return {'memoryMiB': container['HostConfig']['Memory'] // MIB,
                'dbMaxOpenConnections': int(env['DATABASE_MAX_OPEN_CONNS'])}

    def status(self):
        with self.lock:
            raw = self.compose.read_bytes()
            try:
                effective = self.effective()
            except Exception:
                effective = None
            public = None if not self.job else {key: self.job[key] for key in
                ('id', 'status', 'actor', 'startedAt', 'finishedAt', 'message') if key in self.job}
            return {'revision': digest(raw), 'configured': self.configured(yaml.safe_load(raw)),
                    'effective': effective, 'applying': bool(self.job and self.job['status'] == 'applying'), 'lastApply': public}

    def save_job(self):
        atomic(self.state / 'job.json', json.dumps(self.job, ensure_ascii=False).encode())

    def compose_command(self, path=None):
        return ['docker', 'compose', '--project-directory', str(self.compose.parent), '-f', str(path or self.compose)]

    def start(self, payload):
        with self.lock:
            if self.job and self.job['status'] == 'applying':
                raise ControlError('已有参数正在应用，请等待完成', 409)
            if not isinstance(payload, dict) or set(payload) != {'revision', 'memoryMiB', 'dbMaxOpenConnections', 'actor'}:
                raise ControlError('只允许修改数据库连接数和内存上限')
            raw = self.compose.read_bytes()
            document = yaml.safe_load(raw)
            service = document['services']['sub2api']
            idle = int(environment(service).get('DATABASE_MAX_IDLE_CONNS', 3))
            if payload['revision'] != digest(raw):
                raise ControlError('配置已变化，请重新载入后再应用', 409)
            if type(payload['memoryMiB']) is not int or not 256 <= payload['memoryMiB'] <= 768:
                raise ControlError('内存上限必须是 256 至 768 MiB 的整数')
            if payload['memoryMiB'] * MIB > memory_bytes(service['memswap_limit']):
                raise ControlError('内存上限不能超过现有内存与 swap 总预算')
            if type(payload['dbMaxOpenConnections']) is not int or not idle <= payload['dbMaxOpenConnections'] <= 50:
                raise ControlError('数据库连接数不能小于空闲连接数，且不能超过 50')
            if not isinstance(payload['actor'], str) or not 1 <= len(payload['actor']) <= 254:
                raise ControlError('操作人无效')
            snapshot = self.inspect()
            if not snapshot['State']['Running']:
                raise ControlError('Sub2API 未运行，请先恢复服务', 503)
            target = {key: payload[key] for key in ('memoryMiB', 'dbMaxOpenConnections')}
            previous = self.effective()
            identifier = uuid.uuid4().hex
            backup = self.backups / identifier
            backup.mkdir(mode=0o700)
            atomic(backup / 'compose.yml', raw)
            self.job = {'id': identifier, 'status': 'applying', 'actor': payload['actor'], 'startedAt': now(),
                        'message': '正在应用参数', 'target': target, 'previous': previous,
                        'beforeHash': digest(raw), 'candidateHash': None,
                        'imageId': snapshot['Image'], 'swapBytes': snapshot['HostConfig']['MemorySwap'],
                        'mutated': False, 'restart': previous['dbMaxOpenConnections'] != target['dbMaxOpenConnections']}
            self.save_job()
            self.worker = threading.Thread(target=self.apply, args=(document, raw))
            self.worker.daemon = True
            self.worker.start()
            return self.status()

    def finish(self, status, message):
        with self.lock:
            self.job.update(status=status, message=message, finishedAt=now())
            self.save_job()
            print('runtime apply {} {}'.format(self.job['id'], status), flush=True)

    def apply(self, document, raw):
        phase = 'prepare'
        try:
            service = document['services']['sub2api']
            backup = self.backups / self.job['id']
            if self.job['restart']:
                # 自更新后的二进制必须与重建镜像一致，否则重建会意外降级。
                phase = 'preserve-version'
                version_output = self.runner(['docker', 'exec', 'sub2api', '/app/sub2api', '-version'])
                version = re.search(r'Sub2API (\d+\.\d+\.\d+)(?:\s|$)', version_output)
                if not version:
                    raise RuntimeError('Cannot determine running version')
                image = 'weishaw/sub2api:' + version[1]
                self.runner(['docker', 'cp', 'sub2api:/app/sub2api', str(backup / 'sub2api')])
                if service['image'] != image:
                    self.runner(['docker', 'pull', image])
                service['image'] = image
            service['mem_limit'] = str(self.job['target']['memoryMiB']) + 'm'
            environment(service)['DATABASE_MAX_OPEN_CONNS'] = str(self.job['target']['dbMaxOpenConnections'])
            candidate = yaml.safe_dump(document, allow_unicode=True).encode()
            # 相同值也允许核验，不为格式化 YAML 重启容器。
            self.job['candidateHash'] = digest(candidate)
            self.save_job()
            if digest(self.compose.read_bytes()) != digest(raw):
                raise RuntimeError('External compose edit')
            phase = 'persist-compose'
            self.job['mutated'] = True
            self.save_job()
            atomic(self.compose, candidate)
            phase = 'apply-container'
            if self.job['restart']:
                self.runner(self.compose_command() + ['up', '-d', '--no-build', '--no-deps', '--pull', 'never', 'sub2api'])
            elif self.job['previous']['memoryMiB'] != self.job['target']['memoryMiB']:
                self.runner(['docker', 'update', '--memory', str(self.job['target']['memoryMiB'] * MIB),
                             '--memory-swap', str(self.job['swapBytes']), 'sub2api'])
            phase = 'health-and-effective-check'
            self.health()
            if self.effective() != self.job['target']:
                raise RuntimeError('Effective values mismatch')
            self.finish('succeeded', '参数已保存并生效')
        except Exception as error:
            print('runtime apply {} failed at {} ({})'.format(self.job['id'], phase, type(error).__name__), flush=True)
            self.rollback()

    def rollback(self):
        try:
            backup = self.backups / self.job['id']
            current = digest(self.compose.read_bytes())
            if current not in (self.job['beforeHash'], self.job.get('candidateHash')):
                raise RuntimeError('External compose edit; preserve operator changes')
            if not self.job.get('mutated') and current == self.job['beforeHash']:
                self.finish('failed', '准备阶段未完成，原配置和运行参数未改变')
                return
            original = (backup / 'compose.yml').read_bytes()
            atomic(self.compose, original)
            if self.job['restart'] and (backup / 'sub2api').exists():
                document = yaml.safe_load(original)
                document['services']['sub2api']['image'] = self.job['imageId']
                rollback_compose = backup / 'rollback.yml'
                atomic(rollback_compose, yaml.safe_dump(document, allow_unicode=True).encode())
                self.runner(self.compose_command(rollback_compose) + ['up', '--no-start', '--force-recreate', '--no-build', '--no-deps', '--pull', 'never', 'sub2api'])
                self.runner(['docker', 'cp', str(backup / 'sub2api'), 'sub2api:/app/sub2api'])
                self.runner(['docker', 'start', 'sub2api'])
            else:
                self.runner(['docker', 'update', '--memory', str(self.job['previous']['memoryMiB'] * MIB),
                             '--memory-swap', str(self.job['swapBytes']), 'sub2api'])
            self.health()
            if self.effective() != self.job['previous']:
                raise RuntimeError('Rollback verification failed')
            self.finish('rolled_back', '应用未完成，已恢复原配置及运行参数')
        except Exception:
            self.finish('rollback_failed', '应用及自动恢复未完成，请管理员检查宿主机服务日志')

    def recover(self):
        if self.job and self.job['status'] == 'applying':
            self.rollback()


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.handle_settings(False)

    def do_POST(self):
        self.handle_settings(True)

    def handle_settings(self, update):
        try:
            if self.path != '/settings':
                raise ControlError('路径不存在', 404)
            if update:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    raise ControlError('请求大小无效')
                payload = json.loads(self.rfile.read(length))
                body, code = self.server.controller.start(payload), 202
            else:
                body, code = self.server.controller.status(), 200
        except ControlError as error:
            body, code = {'error': str(error)}, error.status
        except Exception:
            body, code = {'error': '运行参数控制服务暂时不可用'}, 503
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    state = pathlib.Path('/var/lib/sub2api-runtime-control')
    controller = Controller('/opt/sub2api/compose.yml', state)
    controller.recover()
    socket = state / 'control.sock'
    if socket.exists():
        socket.unlink()
    with Server(str(socket), Handler) as server:
        server.controller = controller
        os.chown(str(socket), 0, 1000)
        os.chmod(str(socket), 0o660)
        server.serve_forever()
