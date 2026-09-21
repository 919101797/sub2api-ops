# 第三方代码与素材声明

根目录 [MIT 许可证](LICENSE)适用于本项目原创代码与文档。以下第三方代码、图标和素材不在该再授权范围内，仍遵循各自条款；依赖的完整许可文本随其 npm 包提供。

## React Bits

- 组件：Ferrofluid、Light Tunnel
- 项目：<https://github.com/DavidHDev/react-bits>
- 许可证：MIT License + Commons Clause；[上游原文](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)，完整文本另存于 [LICENSES/React-Bits.txt](LICENSES/React-Bits.txt)。
- 本地范围：`web/src/components/open-source/Ferrofluid.tsx`、`Ferrofluid.css`、`LightTunnel.tsx`、`LightTunnel.css`。
- 根目录 MIT 许可不覆盖这些组件；当前上游许可包含对组件自身销售、再许可和再分发的限制。

组件源码取自 React Bits 官方 registry，保留来源注释，并调整了像素预算、可见性与减弱动态效果响应。

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## OGL

- 软件包：`ogl` 1.0.11
- 项目：<https://github.com/oframe/ogl>
- 许可证：Unlicense

完整许可证随 npm 软件包保留在运行时镜像中。

## Motion

- 软件包：`motion` 13.2.0 及其依赖
- 项目：<https://github.com/motiondivision/motion>
- 许可证：MIT；完整许可证随 npm 软件包保留在运行时镜像中。
- 用途：Tab 和分段选择器的共享布局与弹簧动画。

## NASA 天体影像

- `earth-blue-marble.webp`：NASA / Visible Earth，Blue Marble（2002），[原始影像](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57723/globe_west_2048.jpg)。
- `moon-lro.webp`：NASA / GSFC / Arizona State University，Lunar Reconnaissance Orbiter，[Lunar Near Side](https://science.nasa.gov/resource/lunar-near-side/)。
- 用于奔月场景中的地球与月球，经过缩放、透明边缘和月球受光处理；月表地形与旅程是艺术化模拟。NASA 影像不表示 NASA 对本产品的认可。

## 奔月：古今叙事素材

`web/src/assets/moon-story/change.png`、`moon-palace.png`、`crew-rocket.png`、`era-clouds.png` 使用内置 `image_gen` 生成，保留透明通道，用于分层概念场景；不是历史照片或特定航天任务实拍。完整生成提示词见同目录 `prompts.json`。月球、地球与月面继续使用上文列明的原素材。

现代部分以多级载人运载火箭、逃逸塔与飞船舱体构型为视觉参考，任务叙事不标记为已发生的中国载人登月。参考：中国载人航天工程办公室[新一代载人运载火箭介绍](https://statistics.cmse.gov.cn/xwzx/202406/t20240614_55566.html)、[长征十号与梦舟飞行试验](https://www.cmse.gov.cn/xwzx/202602/t20260211_57264.html)。

### 神话交互场景原创素材

`web/src/assets/myth-stories/` 中的远景盘古形象、女娲侧影与银蓝云纱材质由本次任务使用内置 image_gen 工具生成，PNG 保留透明度并在项目本地打包。完整提示词见同目录 `prompts.json`。人物仅作分层素材，云纱舒展、星光路径与织补由代码按可逆进度绘制；不引用真实人物照片。

## 直接运行依赖

以下版本按当前 `package-lock.json` 和包自身许可声明记录。更新依赖时复核其包内 LICENSE；表格不替代完整许可文本。

| 软件包 | 锁定版本 | 包声明的许可证 |
| --- | --- | --- |
| `@fastify/helmet` | 13.1.0 | MIT |
| `@fastify/rate-limit` | 11.2.0 | MIT |
| `@fastify/secure-session` | 8.3.0 | MIT |
| `@fastify/static` | 10.1.3 | MIT |
| `@icons-pack/react-simple-icons` | 13.15.1 | MIT |
| `@marsidev/react-turnstile` | 1.6.0 | MIT |
| `@tanstack/react-query` | 5.101.4 | MIT |
| `chinese-days` | 1.5.9 | MIT |
| `fastify` | 5.12.0 | MIT |
| `lucide-react` | 1.33.0 | ISC |
| `motion` | 13.2.0 | MIT |
| `ogl` | 1.0.11 | Unlicense |
| `pg` | 8.23.0 | MIT |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `react-router-dom` | 7.18.2 | MIT |
| `react-select` | 5.10.2 | MIT |
| `ws` | 8.21.3 | MIT |
| `zod` | 4.4.3 | MIT |

图标标识可能涉及各品牌商标，软件许可证不授予商标使用权。生成素材不表示任何人物、机构或任务对本项目的认可。
