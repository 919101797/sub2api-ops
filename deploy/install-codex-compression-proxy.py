#!/usr/bin/env python3
"""在 macOS 安装本机传输代理；配置切换独立进行，方便先验收再接入。"""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('upstream', help='固定 HTTPS 源站，例如 https://sub2api.example.com')
parser.add_argument('--port', type=int, default=18086)
args = parser.parse_args()
origin = urlsplit(args.upstream)
if sys.platform != 'darwin' or origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
    parser.error('仅支持 macOS 与 HTTPS 上游')
if not 1024 <= args.port <= 65535:
    parser.error('端口必须介于 1024 和 65535')
node = shutil.which('node')
if not node:
    parser.error('需要 Node.js 24 或更高版本')
subprocess.run([node, '-e', "if (!require('node:zlib').zstdDecompress) process.exit(1)"], check=True)
label = 'com.example.sub2api.codex-compression'
target = Path.home() / 'Library/Application Support/Sub2API Compression'
target.mkdir(parents=True, exist_ok=True, mode=0o700)
source = Path(__file__).with_name('codex-compression-proxy.mjs')
shutil.copy2(source, target / source.name)
os.chmod(target / source.name, 0o600)
agents = Path.home() / 'Library/LaunchAgents'
agents.mkdir(parents=True, exist_ok=True)
plist = agents / (label + '.plist')
configuration = {
    'Label': label,
    'ProgramArguments': [node, str(target / source.name), args.upstream, str(args.port)],
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 5,
    'StandardOutPath': str(target / 'transport.log'),
    'StandardErrorPath': str(target / 'error.log'),
    'Umask': 0o077,
}
unchanged = plist.exists() and plist.read_bytes() == plistlib.dumps(configuration)
plist.write_bytes(plistlib.dumps(configuration))
plist.chmod(0o600)
service = 'gui/' + str(os.getuid())
def loaded():
    return subprocess.run(['launchctl', 'print', service + '/' + label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

if unchanged and loaded():
    subprocess.run(['launchctl', 'kickstart', '-k', service + '/' + label], check=True)
else:
    if loaded():
        subprocess.run(['launchctl', 'bootout', service + '/' + label], check=True)
        for _ in range(40):
            if not loaded():
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('旧代理尚未退出，请检查 launchctl 状态')
    subprocess.run(['launchctl', 'bootstrap', service, str(plist)], check=True)
for _ in range(40):
    try:
        with urlopen('http://127.0.0.1:' + str(args.port) + '/health', timeout=1) as response:
            if response.status == 200:
                break
    except OSError:
        pass
    time.sleep(0.25)
else:
    raise RuntimeError('本机代理健康检查未通过')
print('本机代理已安装：http://127.0.0.1:' + str(args.port) + '/v1')
print('运行目录：' + str(target))
