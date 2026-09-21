# Sub2API 集成契约

Ops 使用现有 Sub2API 的管理 API 和数据库，没有捆绑或派生 Sub2API 服务。接口适配入口是 [`server/sub2api-client.ts`](../../server/sub2api-client.ts)，共享 UI 契约见 [`shared/contracts.ts`](../../shared/contracts.ts)。

## 管理 API

以下路径相对于 `SUB2API_BASE_URL`（通常以 `/api/v1` 结尾）。服务端管理请求使用管理员 API Key；用户登录沿用上游鉴权。

| 范围 | 主要接口 | 用途 |
| --- | --- | --- |
| 公开配置与身份 | `/settings/public`、`/auth/login`、`/auth/login/2fa`、`/auth/me`、`/auth/refresh`、`/auth/logout` | 登录、验证管理员与刷新会话 |
| OAuth | `/auth/oauth/:provider/start` | 上游身份流程，需配置回调分流 |
| 账号与用量 | `/admin/accounts`、`/admin/openai/accounts/:id/quota`、`/admin/accounts/:id/usage` | 账号查找、周期与成本 |
| 分组与订阅 | `/admin/groups`、`/admin/groups/:id`、`/admin/subscriptions`、`/admin/subscriptions/:id/reset-quota` | 分配周限与周期重置 |
| 用户策略 | `/admin/users`、`/admin/users/batch-limits` | 读取活跃用户，批量更新并发和 RPM |
| 风险解封 | `/admin/risk-control/users/:id/unban` | 管理员手动解除风险封禁 |

分页、请求与响应字段以客户端实现及其相邻测试为准。上游缺少批量限流、风险控制或其他接口时，对应功能不能仅凭登录成功推定可用。

## PostgreSQL

连接上游已初始化的数据库。用量分析读取 `public.usage_logs`、`public.users` 和 `public.user_subscriptions`；审计依赖 `public.content_moderation_logs`，身份解析函数还引用 `public.api_keys`、`public.groups` 等上游表。

Ops 自有对象位于 `sub2api_ops` schema，通过 [`server/prompt-audit/schema.sql`](../../server/prompt-audit/schema.sql)由管理员预先创建。运行时检查 schema；普通应用账号不承担建角色、授权或上游初始化。[部署指南](../operations/deployment.md#数据库准备)提供权限配置。

数据库表结构是集成契约的一部分。上游升级后，应使用隔离环境验证 SQL 字段和管理 API，再升级生产；本项目未声明覆盖全部 Sub2API 版本的兼容矩阵。

## HTTP 与 WebSocket

Nginx 将 HTTP `/v1/responses` 请求体镜像至内部采集入口，主请求仍发往 Sub2API；Upgrade 请求交给 Relay。Relay 向 Sub2API 转发前先写入审计发件箱，采集成功后移除，失败则重试。采集密钥只在可信内部链路使用。

OAuth 使用同域回调分流和短时标记 Cookie。路径、upstream、header 和采集模板必须与[部署文档](../operations/deployment.md#nginx-接入)保持一致。

## 验证边界

自动化测试覆盖客户端请求、解析、业务逻辑、路由和界面模拟；不包含真实 Sub2API、PostgreSQL、Nginx、OAuth 提供商或公网模型服务。真实接入验证应检查管理员登录、查询、受控自动化写入、HTTP 审计和双轮 WS 审计，并确认没有修改无关账号、分组或服务。
