# 项目规则

1. 读 `docs/specs/README.md`，按改动路径定位一份规格；架构或部署变化再读对应文档。
2. 行为变化先改原规格场景；新独立能力才新增功能编号。
3. BDD 写可观察实例；TDD 按“失败测试→最小实现→重构”推进，测试留在源码附近。
4. 先跑索引中的最小命令；命中 `docs/development/testing.md` 的全量条件再跑全量检查。
5. 不新增不可执行的 `.feature`、过程报告、兼容层或重复规则。

完成条件：规格、实现、测试一致；相关测试通过；必要时通过 `npm run typecheck && npm test && npm run build`；文档和配置示例同步。

硬约束：不派生 Sub2API 镜像；不在生产机构建；只部署本地构建的 `linux/amd64` 镜像；不覆盖 `.env`、`config.json`、`data/`；秘密不进仓库。
