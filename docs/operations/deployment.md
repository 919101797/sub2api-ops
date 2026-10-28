# 部署

配合[配置参考](configuration.md)、[集成契约](../system/integration.md)和[故障排查](troubleshooting.md)使用。以下示例用于 Linux 主机上的 Docker Compose + 主机 Nginx；Sub2API、PostgreSQL 和 TLS 证书需提前准备。镜像需自行构建，本仓库不承诺预发布镜像。

边界：Sub2API 只用官方镜像；生产机不运行 Node.js、npm 或 Docker 构建；不得覆盖 `.env`、`config.json`、`data/`。

## 3.10.7 主动余量再均分

按账号开启并保存后立即检查，扣除账号已用标准成本与预留，将估算余量按份数等额追加，无需等待成员用完。后续只追加新增且尚未分配的额度；本周期水位与绝对目标持久保存，重复检查、消费已发额度、关闭再开启和重启不重复发放。开始追加后，普通容量同步只更新估值，周限由分配记录维护，避免同一笔增长重复发放。

确认新周期时自动关闭并保存该账号开关；保存失败保留重置计划，重启续跑保持关闭，其他账号不受影响。

仅需更新 `operations-console` 至 `3.10.7`，保留现有 `ws-audit-relay`，不重建 Sub2API 或数据库。保留 `.env`、`config.json`、`data/` 和请求策略；已开启账号会在启动后的容量检查主动追加。验收逐组周限、追加轮数及水位，重复执行容量检查确认无重复，并检查未开启账号不变。回滚只恢复编排和旧镜像，不回滚已发额度或覆盖运行状态；需要停止后续追加时关闭对应账号开关。

## 3.10.6 WebSocket 保活与设置修复

中继每 25 秒向客户端发送 WebSocket Ping；75 秒没有 Pong、输入字节进展且没有落盘暂停时，终止失联连接及对应上游并释放通道。控制帧不变成模型输入或审计正文。连接日志补充两端关闭码、用户 ID、轮数及持续时间，不记录 Key、正文或关闭原因原文。上游模型本身的长等待和断开后的内部计费排空行为仍由官方 Sub2API 控制。

请求限制相同值重复保存保留原修订、时间和操作人；只改其他用户或并发数不会打断已有会话。当前用户有效大小上限或大请求通道归属变化时，下一条输入仍以 1012 要求重连，以重新建立正确的接收与通道限制。

两项服务镜像更新至 `3.10.6`；保留用户策略和受保护配置，先更新控制台确认健康，再单独更新中继。中继重建有一次短暂重连，Sub2API 与数据库不重建。验收包含跨越两分钟空闲后原会话续跑、Ping/Pong、异常关闭释放、重复保存与其他用户修改不重连，以及原策略、发件箱和暂存目录清理。回滚只恢复编排及旧镜像。

## 3.10.5 移除固定上传名额

HTTP 网关删除固定 8 个上传计数与对应 429，不另增上传排队或隐藏名额。8 个普通请求仍在接收正文时，第 9 个可继续上传，完成后按原大小校验转发。每请求仍流式解压与背压落盘，保留磁盘空间检查、取消清理、SSE 保活和耗时日志；用户大小上限及 Ops 配置的大请求通道保留，账号限流与服务器资源上限仍然有效。

两项服务镜像同步至 `3.10.5`。升级保持 `.env`、`config.json`、`data/` 及用户请求策略，不重建 Sub2API 或数据库。先单独更新控制台并确认健康，再单独更新中继，缩短中继重连窗口。回滚只恢复编排与旧镜像，不覆盖配置或运行数据。

## 3.10.4 长请求连接修复

本次同时更新控制台与中继至 `3.10.4`，不改 Sub2API 官方镜像、账号、数据库、请求策略或容器内存。HTTP 上传计数在完整落盘校验后立即释放；模型生成与响应不会继续占上传名额。明确声明 `Accept: text/event-stream` 的 Responses 请求，在等 Sub2API 响应头时每 10 秒发送 SSE 注释，防止边缘空闲超时导致重复提交；JSON 与 compact 保留原 HTTP 状态。保活一旦提交 HTTP 200，晚到的上游 HTTP 错误会用终止 SSE `error` 事件返回，客户端必须按流事件判断是否完成。

中继每个 HTTP 请求记录 `requestId/userId/bodyBytes/authMs/uploadMs/upstreamHeadersMs/responseMs/totalMs/upstreamStatus/status/keepalive/clientDisconnected`。耗时从请求进入网关开始，不含客户端到 Nginx 的上传；不记录 Key、查询参数、正文或上游错误详情。`upstreamHeadersMs` 包含 Sub2API 向代理与模型发起请求的等待，不能直接当成模型服务商耗时。

升级前保存编排、受保护文件与策略哈希，确认发件箱没有旧格式未确认消息。仅替换两项镜像并执行 `docker compose up -d --no-build --no-deps operations-console ws-audit-relay`；中继重建会使现有连接短暂重连。验收真实 Responses HTTP/WS 完成、保活、普通错误状态、日志阶段耗时、策略原值、发件箱与暂存清理及独立采样。回滚只恢复编排和旧镜像，保留 `.env`、`config.json`、策略及业务数据。

## 资源与请求大小设置

先在宿主机按需安装 `deploy/resource-monitor/install.sh`；采样器要求 Docker cgroup v1 的 `/sys/fs/cgroup/memory/docker` 布局，每 15 秒采样并保留 7 天。Compose 将采样目录只读挂载到控制台，未安装时页面显示不可用。

运行参数控制器要求 Python 3 和 PyYAML，固定管理 `/opt/sub2api/compose.yml`；先核对实际编排目录后安装 `deploy/runtime-control/install.sh`。控制台只连接 Unix socket，不挂载 Docker socket；更改固定目录时同步审查控制器、安装脚本和 systemd ReadWritePaths，不通过 API 接受任意路径或命令。

Ops「系统设置 → 请求限制」可维护默认/用户上限（1–100 MiB）、大请求阈值和任意正整数并发，策略首次由控制台创建，后续升级保留 `data/request-limits/policy.json`。Sub2API 的 `SERVER_MAX_REQUEST_BODY_SIZE`、`GATEWAY_MAX_BODY_SIZE`、`GATEWAY_TEXT_MAX_BODY_SIZE`、`GATEWAY_OPENAI_WS_CLIENT_READ_LIMIT_BYTES` 必须设为 `104857600`，并保留正在运行的官方程序版本；它的重建会中断在途请求。中继只读挂载策略目录，先启动控制台初始化策略。审计正文阈值独立，不随用户上限改变。

首次应用 `schema.sql` 还会创建受限的 `resolve_api_key` 函数并授权审计写入角色，用于网关确认真实用户，不向网关开放全部 API Key 表。升级前须由数据库管理员检查并应用当前脚本。`data/` 归 UID/GID 1000，策略目录 0700、策略文件 0600。

## 准备

1. 复制项目目录，首次使用 `cp -n .env.example .env` 和 `cp -n config.example.json config.json` 创建本地配置，设置权限为 `600`；填写全部占位符。
2. `SUB2API_DOCKER_NETWORK` 指向 Sub2API 网络；`WS_RELAY_UPSTREAM_ORIGIN` 使用容器内源站，禁止公网环路。
3. 按下节准备数据库角色并应用 `server/prompt-audit/schema.sql`；运行账号不负责建库授权。
4. 按下节定义 Nginx upstream 和升级连接 map，再安装 OAuth 与审计片段，先执行 `nginx -t`。
5. 设置持久目录权限：

```bash
mkdir -p data/prompt-media data/ws-audit-outbox data/request-limits
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
docker buildx build --platform linux/amd64 -t sub2api-operations-console:3.10.4 --load .
docker save sub2api-operations-console:3.10.4 | gzip > sub2api-operations-console-3.10.4-amd64.tar.gz
scp sub2api-operations-console-3.10.4-amd64.tar.gz root@目标服务器:/tmp/
```

## 服务器启动

```bash
gzip -dc /tmp/sub2api-operations-console-3.10.4-amd64.tar.gz | docker load
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
