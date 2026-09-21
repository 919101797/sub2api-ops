# 部署

配合[配置参考](configuration.md)、[集成契约](../system/integration.md)和[故障排查](troubleshooting.md)使用。以下示例用于 Linux 主机上的 Docker Compose + 主机 Nginx；Sub2API、PostgreSQL 和 TLS 证书需提前准备。镜像需自行构建，本仓库不承诺预发布镜像。

边界：Sub2API 只用官方镜像；生产机不运行 Node.js、npm 或 Docker 构建；不得覆盖 `.env`、`config.json`、`data/`。

## 准备

1. 复制项目目录，首次使用 `cp -n .env.example .env` 和 `cp -n config.example.json config.json` 创建本地配置，设置权限为 `600`；填写全部占位符。
2. `SUB2API_DOCKER_NETWORK` 指向 Sub2API 网络；`WS_RELAY_UPSTREAM_ORIGIN` 使用容器内源站，禁止公网环路。
3. 按下节准备数据库角色并应用 `server/prompt-audit/schema.sql`；运行账号不负责建库授权。
4. 按下节定义 Nginx upstream 和升级连接 map，再安装 OAuth 与审计片段，先执行 `nginx -t`。
5. 设置持久目录权限：

```bash
mkdir -p data/prompt-media data/ws-audit-outbox
chown -R 1000:1000 data
chown 1000:1000 config.json
chmod 600 config.json
```

## 数据库准备

先让 Sub2API 完成自己的数据库初始化（需要 `users`、`api_keys`、`groups`、`user_subscriptions`、`usage_logs`、`content_moderation_logs`）。使用数据库管理员通过交互式 `psql` 创建以下角色；`\password` 交互设置密码，避免将密码写入脚本。以下 SQL 仅用于首次安装，数据库名称假设为 `sub2api`：

```sql
CREATE ROLE sub2api_ops_reader LOGIN;
CREATE ROLE sub2api_ops_writer LOGIN;
\password sub2api_ops_reader
\password sub2api_ops_writer
GRANT CONNECT ON DATABASE sub2api TO sub2api_ops_reader, sub2api_ops_writer;
GRANT USAGE ON SCHEMA public TO sub2api_ops_reader, sub2api_ops_writer;
GRANT SELECT ON public.usage_logs, public.users, public.user_subscriptions TO sub2api_ops_reader;
\i server/prompt-audit/schema.sql
```

从项目根目录运行 psql，以具备建 schema、函数及授权权限的管理员执行。`schema.sql` 中的审计角色固定为 `sub2api_ops_writer`，与 `.env.example` 一致；`.env` 的 `SUB2API_DB_USER` 填 `sub2api_ops_reader`。数据库地址必须能被运行 Ops 的主机或容器访问。

## Nginx 接入

Nginx 在主机运行，控制台与 Relay 端口仅绑定回环地址。以下内容放入 Nginx 的 `http` 配置上下文，Sub2API 本地端口按实际情况调整：

```nginx
map $http_upgrade $connection_upgrade_ops {
    default upgrade;
    '' close;
}
upstream sub2api_backend { server 127.0.0.1:8081; }
upstream sub2api_ops_backend { server 127.0.0.1:3002; }
```

在已配置 TLS 的 Sub2API `server` 块中添加以下内容，`PUBLIC_ORIGIN` 填该站点 HTTPS origin。现有相同 location 需合并，不能重复声明：

```nginx
location = /ops { return 302 /ops/; }
location /ops/ {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://sub2api_ops_backend;
}
include /etc/nginx/snippets/sub2api-oauth.conf;
include /etc/nginx/snippets/sub2api-prompt-audit.conf;
```

复制 `deploy/nginx-sub2api-oauth.conf` 到对应 snippets 路径。安装脚本将审计模板的 `__CAPTURE_SECRET__` 和 `__WS_RELAY_HOST_PORT__` 替换后写入审计片段；生成片段含秘密，仅保留在目标服务器。首次部署时先将代码和配置放至 `/opt/sub2api-ops`，复制 OAuth 片段，并设置 server / upstream。审计 include 可先写入尚未 reload 的配置；随后安装脚本会生成审计片段，执行 `nginx -t` 后再 reload。不要在片段不存在时提前 reload。默认 Ops 端口为 `3002`，更改后需同步修改 upstream。

Compose 加入现有外部 Docker 网络，`.env` 中的 `SUB2API_DOCKER_NETWORK` 必须指向 Sub2API 实际网络，且其 DNS 名称 `sub2api` 可解析；示例 `sub2api_default` 不是自动创建的网络。

## 本地构建

```bash
npm ci
npm run typecheck
npm test
npm run build
docker buildx build --platform linux/amd64 -t sub2api-operations-console:3.6.0 --load .
docker save sub2api-operations-console:3.6.0 | gzip > sub2api-operations-console-3.6.0-amd64.tar.gz
scp sub2api-operations-console-3.6.0-amd64.tar.gz root@目标服务器:/tmp/
```

## 服务器启动

```bash
gzip -dc /tmp/sub2api-operations-console-3.6.0-amd64.tar.gz | docker load
cd /opt/sub2api-ops
sudo ./deploy/install-operations-console.sh --no-build
```

禁止 `docker build`、`docker compose build`、`docker compose up --build`。

仅升级控制台界面时，确认新旧后端文件一致，备份生产 `compose.yml`、配置与状态，加载新镜像后只更新 `operations-console` 的镜像引用，并执行：

```bash
docker compose up -d --no-build --no-deps operations-console
```

此流程保留 WebSocket 中继容器及其活跃连接。验证控制台版本、静态资源、鉴权入口、两类自动化任务、中继与 Docker DNS；`.env` 和 `config.json` 的哈希应与发布前一致。失败时恢复备份的 `compose.yml`，以同一命令切回旧镜像。

部署成功并通过控制台与 WS Relay 健康检查后，安装脚本逐个删除未被容器引用的旧 `sub2api-operations-console` 镜像，只保留版本号最高的 3 个版本；每次删除之间保留稳定间隔，并重新检查两个服务及容器内的 `sub2api` Docker DNS，任一检查失败立即停止清理。不得使用 `docker system prune` 或跨仓库清理。

## 验证

```bash
docker compose ps
curl --fail http://127.0.0.1:${OPS_HOST_PORT:-3002}/health
curl --fail http://127.0.0.1:${WS_RELAY_HOST_PORT:-3003}/health
docker compose logs --since 10m operations-console ws-audit-relay
```

再验证管理员登录、两类任务、持久化、HTTP 审计和双轮 WebSocket 审计；后者使用 `deploy/verify-ws-audit.mjs`，结束后发件箱应为空。脚本不得输出密钥。

## SSE 出口压缩与本机 Codex

`nginx-sub2api-prompt-audit.conf` 的 HTTP Responses 出口启用协商式 gzip（等级 3），保留 `proxy_buffering off`。无需修改 Sub2API 镜像；更新片段前备份现有文件，只在 `nginx -t` 成功后平滑重载。未声明 gzip 的客户端仍收到原始正文，WebSocket 仍进入现有 Relay。

不自动解压 HTTP 响应的 Codex 客户端通过本机代理接入。macOS 使用现有 Node.js 24+：

```bash
npm run test:compression
python3 deploy/install-codex-compression-proxy.py https://sub2api.example.com
curl --fail http://127.0.0.1:18086/health
```

验收后，将所选供应商的 `base_url` 改为 `http://127.0.0.1:18086/v1`，保留认证、模型及 `supports_websockets` 设置。如果配置由 CC Switch 管理，同时更新其对应供应商，避免切换时还原地址。新任务或重启客户端后读取新配置，不中断现有任务。

代理在 `~/Library/Application Support/Sub2API Compression/`，LaunchAgent 为 `com.example.sub2api.codex-compression`。只监听回环地址，上游使用经过证书校验的 HTTPS；日志只记录状态、字节数、请求编号，不记录请求正文、响应正文或凭据。SSE 响应流式解压，WS 帧保持透明；上传 zstd/gzip 在本机解压并重算长度，以便现有 HTTP 审计采集。这项部署只减少响应出口流量，不减少请求上传流量。

排查时读取 `transport.log` 与 `error.log`；`client_closed` 包括客户端主动取消和模型完成后主动断连，不能据此触发重试。压缩流完整性不代替模型完成事件检查。恢复直连时先把供应商地址改回 HTTPS 上游，再执行 `launchctl bootout gui/$(id -u)/com.example.sub2api.codex-compression`。

迁移保留 `.env`、`config.json`、`data/`，数据库随 PostgreSQL 备份。回滚先恢复 Nginx `.previous` 并重载，再停止中继；发件箱非空时不得删除。
