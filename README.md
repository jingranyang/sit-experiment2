# SIT 小组认同行为实验 — 计算任务

这个仓库包含两个版本，对应两种不同的使用场景：

## 根目录：静态版本（配合 Qualtrics 使用，推荐）

`index.html` + `css/` + `js/` 是一个**纯静态、无需服务器**的页面，可以直接部署在 GitHub Pages 上。它只负责"合作计算任务"这一个环节：随机分组、模拟队友/对方队伍的实时比分、计时。知情同意、分配任务、问卷、debrief 等都放在 Qualtrics 里完成。

- 部署方法、能玩的网址参数、如何跟 Qualtrics 对接（iframe+postMessage 或 网页跳转两种方式）：见 [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md)
- 本地测试：`node test/static_server.js` 启动一个本地静态服务器，然后打开 `http://localhost:8099/?pid=test&group=A&duration=20&difficulty=easy`
- 自动化测试（需要本机已有Playwright + Chromium）：先启动上面的静态服务器，再跑 `node test/playwright_check.js`

## `server-version/`：完整独立版本（不需要 Qualtrics）

一个功能更完整、自带后端的版本：等候室/即时开始、随机分组、后台管理界面（创建研究、查看进度、导出CSV）、完整的分配任务与问卷流程都内置在这一套代码里，适合不想用 Qualtrics、想要一个独立完整实验平台的场景。用 Node.js 内置模块实现（零外部依赖，`node server.js` 直接跑），可以部署到 Render / Railway 这类支持长期运行 Node 进程的平台。详见该目录下的代码。
