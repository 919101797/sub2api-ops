# 开发指南

## 运行环境

使用 Node.js 24 LTS，最低 24.15.0；根目录 `.nvmrc` 可用于 `nvm use`。使用 npm 和已提交的 `package-lock.json`，首次安装执行 `npm ci`。GitHub Actions 同样使用 Node.js 24。

构建和自动化测试无需 Sub2API、数据库或任何真实凭据。运行完整应用则需要可访问的 Sub2API 和 PostgreSQL，并先完成[数据库准备](../operations/deployment.md#数据库准备)。仅启动 `server/test/mock-upstream.mjs` 不足以运行完整应用，它只实现部分测试用管理接口。

## 首次启动

从仓库根目录执行：

```bash
npm ci
cp -n .env.development.example .env
cp -n config.example.json config.json
chmod 600 .env config.json
```

`cp -n` 保留已存在的配置。填写 `.env` 中所有 `replace-with-...` 值，使用[配置参考](../operations/configuration.md)生成密钥并核对数据库权限。示例配置关闭全部受管账号和峰谷策略；先保留关闭状态完成登录与数据读取验证，再配置自己的账号及分组。

macOS / Linux：

```bash
NODE_OPTIONS='--env-file=.env' npm run dev
```

Windows PowerShell：

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.development.example .env }
if (!(Test-Path config.json)) { Copy-Item config.example.json config.json }
# 编辑 .env，填好凭据和生成的密钥后启动。
$env:NODE_OPTIONS = '--env-file=.env'
npm run dev
```

前端 <http://localhost:5173/ops/>；后端 <http://127.0.0.1:8080/health>。Vite 将 `/ops/api` 和 `/health` 代理到后端。`Ctrl+C` 结束开发进程；PowerShell 可用 `Remove-Item Env:NODE_OPTIONS` 清理当前终端的变量。

`.env` 不会被 `npm run dev` 自行加载，必须使用上述 `NODE_OPTIONS`。不要把服务器密钥放进 `VITE_*` 变量，它们可能进入浏览器构建产物。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动后端监听和 Vite；运行前需加载环境变量 |
| `npm run dev:server` | 仅启动 `tsx watch server/index.ts` |
| `npm run dev:web` | 仅启动 Vite；业务 API 仍需后端 |
| `npm run typecheck` | 前后端 TypeScript 检查 |
| `npx vitest run server/config.test.ts` | 最小相关测试 |
| `npm run test:watch` | Vitest 交互监听 |
| `npm test` | 全部 Vitest 和 SSE / WS 压缩测试 |
| `npm run build` | 清理后构建前端与服务端，复制审计 schema |
| `npm start` | 启动 `dist/server/index.js`；仍需环境与数据库 |

不要使用 `npm test -- 路径` 选择 Vitest 文件：`test` 脚本串联了两套测试，附加参数会传到末尾的压缩测试命令。定向执行请使用 `npx vitest run 路径`。

本机检查构建后的服务：

```bash
npm run build
node --env-file=.env dist/server/index.js
```

此时访问 <http://127.0.0.1:8080/ops/>。沿用本地开发配置时 `NODE_ENV` 为 development、Cookie 非 Secure；生产部署使用 Compose 的 production 环境与 HTTPS。

## 代码地图

```text
server/                 Fastify、鉴权、路由、状态和上游客户端
  automation/           周期重置、容量估算、峰谷限流
  prompt-audit/         输入解析、数据库、媒体、留存
  ws-relay/             WebSocket 中继与持久发件箱
shared/contracts.ts     前后端共享数据契约
web/src/
  pages/                业务页面
  components/           共享组件、场景与第三方组件
  styles/               主题、布局、动效和业务样式
  test/                 脱敏 fixture 与测试初始化
scripts/                构建辅助脚本
deploy/                部署、反向代理和压缩工具
docs/specs/             行为规格与测试入口
```

后端采用 NodeNext，TypeScript 源文件的相对模块引用写 `.js` 后缀。前端可用 `@` 和 `@shared` 别名。继续使用当前严格类型选项，不添加重复契约或兼容适配层。

## 修改与调试

先在[规格索引](../specs/README.md)找到对应能力；行为变化更新现有场景，再实现与测试。前端样式和动画参考[设计系统](../product/design-system.md)，检查窄屏、键盘操作和 `prefers-reduced-motion`。

后端日志输出到当前终端，浏览器错误查看开发者工具。调试不能记录 API Key、密码、Cookie、完整提示词或媒体；可使用请求编号关联问题。故障定位见[排障文档](../operations/troubleshooting.md)。

GitHub Actions 执行类型检查、全量测试和构建。CI 通过证明代码检查与模拟测试通过，不表示已验证你的 Sub2API、数据库、Nginx 或 OAuth 配置。
