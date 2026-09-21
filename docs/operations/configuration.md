# 配置参考

配置分为环境变量和业务 JSON。环境变量在启动时读取，修改后需重启对应服务；控制台保存业务配置后会持久化到 `config.json` 并更新任务计划。真实文件不提交到 Git。

## 模板与加载

- [`.env.development.example`](../../.env.development.example)：本地开发，上游示例端口 `8081`，Cookie 允许 HTTP，媒体写入 `./data/prompt-media`。
- [`.env.example`](../../.env.example)：Compose 部署，使用 Docker DNS 和 HTTPS。
- [`config.example.json`](../../config.example.json)：格式版本 11，包含一个关闭的示例账号，用户峰谷策略也关闭。

本地通过 `NODE_OPTIONS='--env-file=.env' npm run dev` 加载；Compose 使用 `env_file` 注入，并以 `environment` 中的值覆盖同名项。请注意 `.env` 的端口设置和 Compose 的容器内部端口不是同一层。

## 控制台环境变量

| 变量 | 默认值 / 要求 | 用途 |
| --- | --- | --- |
| `NODE_ENV` | 默认 `development`，部署为 `production` | 生产日志与 Origin 校验 |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | 后端监听；Compose 内为 `0.0.0.0:8080` |
| `CONFIG_PATH` | `./config.json` | 业务配置文件；Compose 内为 `/app/config.json` |
| `STATE_PATH` | `./data/state.json` | 自动化进度和活动；Compose 内为 `/data/state.json` |
| `SUB2API_BASE_URL` | 默认 `http://sub2api:8080/api/v1` | 必须包含上游管理 API 的 `/api/v1` 前缀 |
| `SUB2API_ADMIN_API_KEY` | 必填 | 服务端访问上游管理 API，不是普通用户的模型调用 Key |
| `SUB2API_DB_HOST` | 必填 | 上游 PostgreSQL 主机 |
| `SUB2API_DB_PORT` | `5432` | PostgreSQL 端口 |
| `SUB2API_DB_NAME` | 必填 | 已初始化的 Sub2API 数据库 |
| `SUB2API_DB_USER` / `SUB2API_DB_PASSWORD` | 必填 | 用量分析只读角色和密码 |
| `PROMPT_AUDIT_DB_USER` / `PROMPT_AUDIT_DB_PASSWORD` | 必填 | 审计读写角色；schema 使用 `sub2api_ops_writer` |
| `PROMPT_CAPTURE_SECRET` | 至少 32 字符 | Nginx、Relay 和控制台共同使用的采集密钥 |
| `PROMPT_MEDIA_PATH` | 默认 `/data/prompt-media` | 媒体目录；本地开发应改为可写相对路径 |
| `SESSION_KEY_BASE64` | 解码后必须恰好 32 字节 | 加密浏览器会话 |
| `PUBLIC_ORIGIN` | 必填，如 `https://sub2api.example.com` | 站点 origin，不含 `/ops`；生产修改请求须匹配 |
| `COOKIE_PATH` | `/ops` | 会话和 API 路径；本发行版前端和代理均按 `/ops/` 接入 |
| `COOKIE_SECURE` | 默认 `false`，Compose 固定 `true` | 生产仅通过 HTTPS 发送 Cookie |

**不要只改 `COOKIE_PATH` 就认为应用已迁移子路径。** Vite 的 `VITE_BASE_PATH`、API 路径及 Nginx 配置还需保持一致；本文档部署方式统一使用 `/ops/`。

生成会话密钥与采集密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

复制输出到本地 `.env`，不要提交。轮换会话密钥会使既有会话失效；轮换采集密钥需要同步更新三个采集参与方和 Nginx 片段。

## Compose 与中继

| 变量 | 默认值 / 要求 | 用途 |
| --- | --- | --- |
| `SUB2API_DOCKER_NETWORK` | 示例 `sub2api_default` | 已存在的 Sub2API 外部网络，须能解析 `sub2api` |
| `OPS_HOST_PORT` | `3002` | 主机回环端口映射到控制台 `8080` |
| `WS_RELAY_HOST_PORT` | `3003` | 主机回环端口映射到 Relay `8090` |
| `TZ` | Compose 默认 `Asia/Shanghai` | 容器时区；不代替业务策略的 `timezone` |
| `WS_RELAY_UPSTREAM_ORIGIN` | 必填，示例 `ws://sub2api:8080` | 内部上游 origin；仅接受 ws / wss，不附路径、query 或 hash |
| `WS_RELAY_HOST` / `WS_RELAY_PORT` | `0.0.0.0` / `8090` | Relay 监听 |
| `WS_AUDIT_CAPTURE_URL` | 必填 | Compose 注入 `http://operations-console:8080/internal/prompts/capture/ws` |
| `WS_AUDIT_OUTBOX_PATH` | `/data/outbox` | 未完成审计投递的持久目录 |
| `WS_AUDIT_OUTBOX_MAX_BYTES` | `536870912`（512 MiB） | 发件箱上限，允许 16 MiB–16 GiB |
| `WS_RELAY_MAX_MESSAGE_BYTES` | `16777216`（16 MiB） | 单条消息上限，允许 1 KiB–64 MiB |

Relay 的 `PROMPT_CAPTURE_SECRET` 必须与控制台一致。上游不得指向已经转发回本 Relay 的公网入口，否则会形成环路。单独本地运行 Relay 时需补全采集 URL 与可写发件箱路径；Compose 已提供这些值。

## 业务配置

完整字段以[配置模板](../../config.example.json)和 [`server/config.ts`](../../server/config.ts)为准，不支持旧版本格式。

| 区域 | 关键字段与约束 |
| --- | --- |
| `version` | 固定为 `11` |
| `fixed_group_ids` | 不参与自动容量写入的分组，不可与账号目标重叠 |
| `reset_sync` | 检查周期 30–86400 秒、请求超时 1–120 秒、周期偏差 0–3600 秒、用量下降容差 0–100% |
| `capacity_sync` | 检查周期 60–86400 秒，最小用量百分比与最小金额变化 |
| `prompt_audit` | 请求体 1–16 MiB；普通留存 1–365 天，风险留存 1–3650 天且不得更短 |
| `accounts` | 至少一项；`key`、邮箱、目标分组归属必须唯一，可保持 `enabled: false` |
| `user_concurrency_schedule` | 开关、IANA 时区、1–4 个不重叠窗口、峰谷并发 / RPM 与豁免用户 |

账号 `key` 为 2–80 位小写字母、数字或连字符；`email` 应与上游受管 OpenAI 账号匹配。`share_count` 范围 1–100；`reserve_mode` 为 `usd` 或 `percent`，`reserve_value` 对应固定 USD 或百分比；`target_group_ids` 至少一个有效分组 ID。模板里的分组 `1` 只是示例，不应直接启用到生产。

峰谷并发为 1–100 的整数，RPM 为 1–10000 的整数，高峰不能大于闲时。豁免用户使用闲时并发与不限 RPM。关闭已启用的峰谷策略会按当前规则恢复用户限额，具体见[功能规格](../specs/009-用户并发时段策略.md)。

## 持久化

Compose 挂载 `config.json` 与 `data/`；应用容器以 UID / GID `1000:1000` 运行。备份需覆盖业务配置、状态、媒体、Relay 发件箱及 PostgreSQL；凭据备份单独限制访问。不要用示例文件覆盖已有配置，不要删除非空发件箱。
