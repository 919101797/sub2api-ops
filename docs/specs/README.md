# 功能索引

长期规格按能力维护，变更原规格；Git 保存历史。开发只读本索引和一份相关规格。

| 编号 | 规格 | 实现范围 | 最小测试 |
| --- | --- | --- | --- |
| 001 | [管理员鉴权](./001-管理员鉴权.md) | `auth.ts`、`routes.ts`、`oauth.ts` | `npx vitest run server/auth.test.ts web/src/lib/oauth.test.ts` |
| 002 | [周期重置](./002-周期重置同步.md) | `automation/engine.ts`、`store.ts` | `npx vitest run server/automation/estimation.test.ts` |
| 003 | [容量同步](./003-动态容量同步.md) | `automation/` | `npx vitest run server/automation` |
| 004 | [配置管理](./004-配置管理.md) | `config.ts`、`SettingsPage.tsx` | `npx vitest run server/config.test.ts` |
| 005 | [用量分析](./005-账号用量分析.md) | `analytics.ts`、`AccountAnalyticsPanel.tsx` | `npx vitest run server/analytics.test.ts` |
| 006 | [提示词审计](./006-提示词审计.md) | `prompt-audit/`、`InputHealthPage.tsx` | `npx vitest run server/prompt-audit` |
| 007 | [WebSocket 中继](./007-WebSocket审计中继.md) | `ws-relay/` | `npx vitest run server/ws-relay` |
| 008 | [控制台交互](./008-控制台交互与信息层级.md) | `web/src/components/`、`pages/` | `npx vitest run web/src/components/AppShell.test.tsx web/src/uiCommentary.test.ts` |
| 009 | [用户峰谷限流策略](./009-用户并发时段策略.md) | `automation/engine.ts`、`sub2api-client.ts`、`SettingsPage.tsx` | `npx vitest run server/automation server/config.test.ts` |
| 010 | [SSE 出口压缩](./010-SSE出口压缩.md) | `deploy/codex-compression-proxy.mjs`、Nginx | `npm run test:compression` |

新独立能力复制 [_template.md](./_template.md)。不创建固定的清单、计划、任务、`.feature` 或验证报告；复杂工作仅在规格中临时列切片，完成后删除任务列表。
