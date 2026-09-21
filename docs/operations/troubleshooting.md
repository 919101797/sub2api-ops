# 故障排查

先确认运行环境、Ops 提交或版本和最近变更，再结合服务日志定位。健康接口、登录、查询、自动化和审计属于不同链路，应分别验证。

## 获取状态

本地运行查看当前终端与浏览器开发者工具。Compose 部署在项目目录执行：

```bash
docker compose ps
docker compose logs --since 10m operations-console ws-audit-relay
curl -i http://127.0.0.1:3002/health
curl -i http://127.0.0.1:3003/health
```

上面使用默认主机端口；自定义后替换为实际值。发送日志前删除凭据、Cookie、个人信息和用户输入，不要直接粘贴 `.env` 或完整数据库查询结果。

## 安装与启动

| 现象 | 定位与处理 |
| --- | --- |
| `EBADENGINE` 或 jsdom 启动错误 | 使用 Node.js 24.15+ 的 24 LTS，检查 `node --version`；切换后重新 `npm ci` |
| 缺少环境变量、Zod 校验失败 | 本地命令使用 `NODE_OPTIONS='--env-file=.env'`，填写全部占位符；Compose 检查 `env_file` 与覆盖值 |
| `SESSION_KEY_BASE64 must decode to exactly 32 bytes` | 重新生成 32 字节随机值的 Base64；不是任意 32 字符字符串 |
| 找不到 `config.json` | 从模板首次创建，或设置有效的 `CONFIG_PATH`；不要覆盖已有真实配置 |
| 数据库 `relation does not exist` / schema 检查失败 | 确认连接的是已初始化的 Sub2API 库，上游审核表存在，并已应用 Ops schema |
| PostgreSQL 权限不足 | 检查只读角色、`sub2api_ops_writer`、表和函数授权；按部署文档由管理员准备 |
| 写配置、状态或媒体出现 `EACCES` | 本地目录需可写；容器挂载属主应为 `1000:1000`，不要将业务配置设为只读挂载 |
| 外部网络不存在、无法解析 `sub2api` | 修改 `SUB2API_DOCKER_NETWORK` 为真实网络并确认容器 DNS 别名，不要创建无关联的空网络掩盖错误 |

## 页面与登录

| 现象 | 定位与处理 |
| --- | --- |
| `/ops/` 空白、JS 404 | 确认前端已构建，Nginx 路径保持 `/ops/`，检查 HTML 引用和部署资源来自同一构建 |
| 开发页面能打开，但 API 失败 | Vite 仅提供前端；检查后端 `8080` 是否启动，以及数据库初始化是否成功 |
| 登录后立即退出 | 本地 HTTP 使用 `COOKIE_SECURE=false`；生产需 HTTPS、正确路径和稳定的会话密钥 |
| 生产修改请求返回 `403` | `PUBLIC_ORIGIN` 须与浏览器实际 origin 完全一致（协议、主机、端口），反向代理保留相关 header |
| 用户拒绝访问 | 上游账号必须同时满足管理员角色与启用状态 |
| OAuth 回调未回到 Ops | 检查上游 OAuth 配置、同域入口、`nginx-sub2api-oauth.conf` 和短时标记 Cookie |
| Turnstile 不能通过 | 确认上游站点设置、访问域名和 Cloudflare challenge 资源可访问 |

## 健康和自动化

控制台 `/health` 在最近自动化任务失败时返回 `503`，不等同于进程已经退出。Compose 对控制台将 `200/503` 都视为可达，确保上游任务失败不会阻止 Relay 启动；安装脚本的验收更严格，仍要求实际健康。

任务没写入时，检查账号 `enabled`、上游邮箱匹配、目标分组、用量阈值及最小变化金额。首次观测周期会建立基线，不应为了制造成功结果而强制重置订阅。按页面活动记录查明原因，必要时阅读对应[功能规格](../specs/README.md)。

用户并发 / RPM 不符合预期时，核对策略开关、时区、工作日、窗口和豁免名单；分组自身 RPM 限制可能优先于用户值。确认上游具有 `/admin/users/batch-limits` 接口。

## 审计与 Relay

HTTP 审计缺失时，确认请求走过配置的 Nginx `/v1/responses`，镜像采集使用正确共享密钥，并且上游审核日志和 Ops 数据库可读写。只直接访问上游端口会绕过镜像链路。

WS 审计缺失时，确认 Upgrade 请求进入 Relay，`WS_RELAY_UPSTREAM_ORIGIN` 指向内部 Sub2API 而非转发回自己的公网入口。Relay 与控制台采集密钥必须一致。

发件箱持续增长通常表示控制台采集不可达、鉴权失败或数据库写入错误。优先修复投递链路并观察队列回落；不要删除发件箱伪造正常状态。发件箱无法写入时中继会关闭连接。

双轮 WS 验收使用 `deploy/verify-ws-audit.mjs`，需要自备可调用模型的测试 Key；它会发起真实请求并可能产生费用。把 `WS_TEST_API_KEY`、`WS_TEST_MODEL`、`WS_TEST_URL` 放入仅本地的 `.env.ws-test` 后运行：

```bash
node --env-file=.env.ws-test deploy/verify-ws-audit.mjs
```

脚本成功还需配合审计列表与发件箱检查，不能仅以 WebSocket 建连成功判断采集完成。

## 升级与回滚

保留旧镜像、Compose 配置、业务配置和一致的数据备份。使用[部署文档](deployment.md)中的 `--no-build` 流程，只重建需要更新的服务。Relay 有活跃连接或待投递数据时先评估影响；不要执行全局 Docker 清理或覆盖 `.env`、`config.json`、`data/`。
