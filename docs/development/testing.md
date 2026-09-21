# TDD、BDD 与测试

## 最小闭环

```text
规格场景 -> 失败测试 -> 最小实现 -> 重构 -> 相关回归
```

- BDD 只写外部可观察实例，保存在一份长期功能规格中。
- TDD 测试放源码附近，不保存红灯/绿灯过程报告。
- 功能编号 `功能-001`；场景编号 `场景-001-01`；新增或修改的验收测试名带场景编号。
- 单元测试只在直接证明业务场景时带编号。
- 不维护不可执行的 `.feature`；当前使用 Vitest、Testing Library 和 `jsdom`。

## 执行层级

| 范围 | 命令 |
| --- | --- |
| 文件 | `npx vitest run server/automation/engine.test.ts` |
| 行 | `npx vitest run server/automation/engine.test.ts:49` |
| 功能 | `npx vitest run server/prompt-audit` |
| 改动相关 | `npx vitest run --changed` |
| 指定源码相关 | `npx vitest related --run server/automation/engine.ts` |
| 全量 | `npm run typecheck && npm test && npm run build` |

`related` 只识别静态依赖；动态加载、Nginx、数据库和部署配置不能依赖它。

UI 的 jsdom 测试最多并行 4 个 worker，避免布局查询在资源竞争下超过业务断言的等待时间。状态测试使用 Motion 的 `skipAnimations` 直接检查落稳状态；弹簧轨迹、连续转向与视觉效果另在浏览器验收。

纯数值轨迹测试使用 Node 环境；密集采样先计算整条轨迹的有限性、最大步长和反向结果，再做整组断言，保留全部采样点和交接边界，避免测试断言本身耗尽 CI 的时间预算。

## 全量触发条件

- `shared/contracts.ts`，鉴权、Cookie、安全头或路由保护。
- 配置、状态、数据库结构、查询、留存或清理。
- 应用启动、错误处理、健康检查、依赖或构建配置。
- Dockerfile、Compose、Nginx、安装或发布脚本。
- 无法可靠判断影响范围、合并主干、构建镜像或生产发布。

## 回溯

当前行为看规格与测试；实现入口看[规格索引](../specs/README.md)；长期原因看 `docs/decisions/`；修改原因看 Git；发布结果看持续集成或发布日志。只有生产、安全、数据库或不可逆操作保存额外验证证据。
