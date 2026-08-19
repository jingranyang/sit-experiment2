# SIT 小组认同行为实验 — 计算任务

这个仓库包含两个版本，对应两种不同的使用场景：

## 根目录：静态版本（配合 Qualtrics 使用，推荐）

`index.html` + `css/` + `js/` 是一个**纯静态、无需服务器**的页面，可以直接部署在 GitHub Pages 上。它依次呈现三个合作任务：先是"合作计算任务"（随机分组、模拟队友/对方队伍的实时比分、计时），然后是"大家来找茬"（同一批模拟队友/对手，比谁完成的"找不同"图片组数更多），最后是"连连看"（点击两个相同方块、用不超过两个转角的连线连起来就消除，比谁清空的棋盘局数更多，越快清空还有额外速度加分）。知情同意、分配任务、问卷、debrief 等都放在 Qualtrics 里完成。

- 部署方法、能玩的网址参数、如何跟 Qualtrics 对接（iframe+postMessage 或 网页跳转两种方式）、三个任务结束后的结果字段说明：见 [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md)
- 本地测试：`node test/static_server.js` 启动一个本地静态服务器，然后打开 `http://localhost:8099/?pid=test&group=A&duration=20&difficulty=easy&diffDuration=30&diffDifficulty=easy&linkDuration=40&linkDifficulty=easy`
- 自动化测试（需要本机已有Playwright + Chromium）：先启动上面的静态服务器，再跑 `node test/playwright_check.js`（覆盖三个任务的完整流程，包括实际点击找茬图片、实际点击连连看方块验证计分逻辑）

## `server-version/`：完整独立版本（不需要 Qualtrics）

一个功能更完整、自带后端的版本：等候室/即时开始、随机分组、后台管理界面（创建研究、查看进度、导出CSV）、完整的分配任务与问卷流程都内置在这一套代码里，适合不想用 Qualtrics、想要一个独立完整实验平台的场景。用 Node.js 内置模块实现（零外部依赖，`node server.js` 直接跑），可以部署到 Render / Railway 这类支持长期运行 Node 进程的平台。详见该目录下的代码。
