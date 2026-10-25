# 功能索引

长期规格按能力维护，变更原规格；Git 保存历史。开发只读本索引和一份相关规格。

| 编号 | 规格 | 实现范围 | 最小测试 |
| --- | --- | --- | --- |
| 001 | [管理员鉴权](./001-管理员鉴权.md) | `auth.ts`、`routes.ts`、`oauth.ts` | `npm test -- server/auth.test.ts web/src/lib/oauth.test.ts` |
| 002 | [周期重置](./002-周期重置同步.md) | `automation/engine.ts`、`store.ts` | `npm test -- server/automation/estimation.test.ts` |
| 003 | [容量同步](./003-动态容量同步.md) | `automation/` | `npm test -- server/automation` |
| 004 | [配置管理](./004-配置管理.md) | `config.ts`、`SettingsPage.tsx`、`runtime-control/`、`RuntimeSettingsPanel.tsx` | `npx vitest run server/config.test.ts server/runtime-control web/src/components/RuntimeSettingsPanel.test.tsx && npm run test:runtime` |
| 005 | [用量分析](./005-账号用量分析.md) | `analytics.ts`、`AccountAnalyticsPanel.tsx` | `npm test -- server/analytics.test.ts` |
| 006 | [提示词审计](./006-提示词审计.md) | `prompt-audit/`、`InputHealthPage.tsx` | `npm test -- server/prompt-audit` |
| 007 | [WebSocket 中继](./007-WebSocket审计中继.md) | `ws-relay/` | `npm test -- server/ws-relay` |
| 008 | [控制台交互](./008-控制台交互与信息层级.md) | `web/src/components/`、`pages/` | `npm test -- web/src/components/AppShell.test.tsx web/src/uiCommentary.test.ts` |
| 009 | [用户峰谷限流策略](./009-用户并发时段策略.md) | `automation/engine.ts`、`sub2api-client.ts`、`SettingsPage.tsx` | `npm test -- server/automation server/config.test.ts` |
| 010 | [SSE 出口压缩](./010-SSE出口压缩.md) | `deploy/codex-compression-proxy.mjs`、Nginx | `npm run test:compression` |
| 011 | [独立资源监控](./011-独立资源监控.md) | `deploy/resource-monitor/`、`server/resource-monitor/`、`ResourcesPage.tsx` | `python3 -m unittest discover -s deploy/resource-monitor && npx vitest run server/resource-monitor web/src/pages/ResourcesPage.test.tsx` |

| 012 | [用户请求大小限制](./012-用户请求大小限制.md) | `request-limits/`、`ws-relay/`、`RequestLimitsPanel.tsx` | `npx vitest run server/request-limits server/ws-relay web/src/components/RequestLimitsPanel.test.tsx` |

新独立能力复制 [_template.md](./_template.md)。不创建固定的清单、计划、任务、`.feature` 或验证报告；复杂工作仅在规格中临时列切片，完成后删除任务列表。
