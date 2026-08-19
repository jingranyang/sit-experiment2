# 如何把这两个合作任务接入 Qualtrics

这个仓库根目录下的静态页面（`index.html` + `css/` + `js/`）负责呈现**两个依次进行的合作任务**：

1. **任务一：合作计算比赛** — 随机分组展示、模拟队友/对方队伍实时比分、计时。
2. **任务二：大家来找茬** — 同一批模拟队友/对手，比一比谁先完成更多组"找不同"（每组图片里所有不同之处都找到才算完成 1 组，计分按"完成的组数"算，不是按"找到的不同处数"算）。

两个任务用的是同一份随机分组和同一批模拟队友/对手人设，参与者会依次完成任务一、任务二，然后一起看到汇总结果。知情同意、说明、分配任务、问卷、debrief 都应该留在 Qualtrics 里完成。

部署后，这个页面的网址大概是：
```
https://你的用户名.github.io/仓库名/
```
（在仓库的 Settings → Pages 里把 Source 设为 `Deploy from branch`，分支选 `master`，文件夹选 `/ (root)`，保存后等1-2分钟生效。）

## 页面支持的网址参数

在网址后面加 `?参数=值`，可以用 `&` 连接多个参数：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `pid` | 参与者/回答的ID，会原样带回结果里 | 随机生成 |
| `group` | 强制指定分到 `A` 或 `B` 组（建议由Qualtrics的随机器决定后传进来，这样后续问题里提到"你的组"能保持一致） | 不传则页面自己随机 |
| `ingroup` | 模拟队友人数（不含参与者本人） | 4 |
| `outgroup` | 模拟对方队伍人数 | 5 |
| `duration` | 任务一（计算）时长（秒），最小10 | 180 |
| `difficulty` | 任务一难度：`easy` / `medium` / `hard` | medium |
| `diffDuration` | 任务二（找茬）时长（秒），最小10 | 120 |
| `diffDifficulty` | 任务二难度：`easy` / `medium` / `hard`（越难图上形状越多、需要找的不同也越多） | medium |
| `bias` | 模拟队友/对手在**两个任务**里进度的倾向：`win` / `lose` / `tie` / `random`（概率性倾向，不是精确保数） | random |
| `returnUrl` | 两个任务都结束后"继续"按钮要跳转回的地址（一般填Qualtrics问卷的网址） | 无 |
| `autostart` | 填 `1` 则跳过"开始"按钮，打开页面直接进入任务一（适合iframe嵌入场景，因为Qualtrics那边已经有说明了）。任务一结束后，任务二仍需要参与者自己点"开始任务二"按钮 | 不跳过 |
| `origin` | postMessage 回传给父窗口时用的 targetOrigin | `*` |
| `debug` | 填 `1` 会把内部状态挂到 `window.__sitDebug` 上，主要给自动化测试用，正常接入不需要 | 不开启 |

两个任务都结束后产出的结果字段：

| 字段 | 含义 |
|---|---|
| `pid` / `group` | 参与者ID / 所在组 |
| `mathOwnCorrect` | 任务一：自己答对几题 |
| `mathTeamTotal` / `mathOtherTeamTotal` | 任务一：本队总分 / 对方总分 |
| `mathOutcome` | 任务一结果：`win` / `lose` / `tie` |
| `mathDurationSec` | 任务一实际时长 |
| `diffPairsCompleted` | 任务二：自己完成了几组"找茬"（每组所有不同都找到才算完成1组） |
| `diffTeamTotal` / `diffOtherTeamTotal` | 任务二：本队总完成组数 / 对方总完成组数 |
| `diffOutcome` | 任务二结果：`win` / `lose` / `tie` |
| `diffDurationSec` | 任务二实际时长 |
| `overallOwnTeamTotal` / `overallOtherTeamTotal` | 两个任务合计：本队 / 对方 |
| `overallOutcome` | 两个任务合计的最终结果：`win` / `lose` / `tie` |

---

## 方式 B：网页跳转（推荐先用这个，不需要写JS）

1. 在Qualtrics的 **Survey Flow** 里，游戏这一步之前加一个 **Embedded Data** 元素，定义好这些字段名（先建好，值先留空）：`sit_pid`、`sit_group`、`sit_mathOwnCorrect`、`sit_mathTeamTotal`、`sit_mathOtherTeamTotal`、`sit_mathOutcome`、`sit_mathDurationSec`、`sit_diffPairsCompleted`、`sit_diffTeamTotal`、`sit_diffOtherTeamTotal`、`sit_diffOutcome`、`sit_diffDurationSec`、`sit_overallOwnTeamTotal`、`sit_overallOtherTeamTotal`、`sit_overallOutcome`
2. 如果你想让Qualtrics决定分组，在这个Embedded Data前用Qualtrics自带的 **Randomizer**（或者用Embedded Data配合公式）生成一个 `group` 字段（值为 A 或 B）
3. 在需要跳转去玩游戏的那道题里，插入一个超链接（Rich Content Editor 里插入链接），地址填：
   ```
   https://你的用户名.github.io/仓库名/?pid=${e://Field/ResponseID}&group=${e://Field/group}&duration=180&diffDuration=120&returnUrl=https://你的数据中心.qualtrics.com/jfe/form/SV_你的问卷ID
   ```
   （`${e://Field/xxx}` 是Qualtrics的"管道文本"写法，会自动替换成实际值；`SV_你的问卷ID` 在问卷的分发链接里能找到）
4. 参与者点这个链接会**离开**Qualtrics页面，先玩任务一（计算），结束后页面上会出现"开始任务二"按钮，点了才会进入任务二（找茬）；两个任务都完成后，结果页上的"继续"按钮会带着全部结果参数跳回你在 `returnUrl` 填的这个问卷地址
5. 因为是同一个浏览器/同一个标签页跳回来，Qualtrics通常会凭浏览器里的进度cookie自动接着上次的进度继续（前提是没关掉"Save and Continue"这个功能，默认是开的）
6. 跳回来的网址会带 `sit_mathOwnCorrect=12&sit_diffPairsCompleted=3&sit_overallOutcome=lose` 这样的参数，如果你在第1步定义的每个Embedded Data字段都设置成"从URL读取"（Embedded Data元素设置里有个"Set Value from URL/Cookie"的选项，把来源设为URL parameter，参数名对应填 `sit_xxx`），Qualtrics加载这个网址时就会自动把值存进去

这个方式的好处是完全不用写代码，缺点是参与者的浏览器要能正常保留session cookie（正常情况下没问题）。

## 方式 A：iframe嵌入 + postMessage（体验更流畅，需要贴一段JS）

1. 在题目里插入一个iframe（Rich Content Editor切到HTML源码模式）：
   ```html
   <iframe id="sitGame" src="https://你的用户名.github.io/仓库名/?pid=${e://Field/ResponseID}&group=${e://Field/group}&duration=180&diffDuration=120&autostart=1" width="100%" height="750" style="border:none;"></iframe>
   ```
   `autostart=1` 只会跳过任务一前面的"开始"按钮；任务一结束后，参与者仍需要在iframe里点一下"开始任务二"按钮才会进入找茬任务（这是故意保留的，好让参与者有机会喘口气、看一眼任务一的结果），不需要额外配置。
2. 点这道题右上角的齿轮图标 → **Add JavaScript**，粘贴：
   ```javascript
   Qualtrics.SurveyEngine.addOnload(function() {
     var qThis = this;
     qThis.hideNextButton(); // 两个任务都玩完之前先隐藏"下一题"按钮
     window.addEventListener('message', function (event) {
       if (!event.data || event.data.type !== 'sit_task_complete') return;
       var d = event.data.payload;
       qThis.setEmbeddedData('sit_pid', d.pid);
       qThis.setEmbeddedData('sit_group', d.group);
       qThis.setEmbeddedData('sit_mathOwnCorrect', d.mathOwnCorrect);
       qThis.setEmbeddedData('sit_mathTeamTotal', d.mathTeamTotal);
       qThis.setEmbeddedData('sit_mathOtherTeamTotal', d.mathOtherTeamTotal);
       qThis.setEmbeddedData('sit_mathOutcome', d.mathOutcome);
       qThis.setEmbeddedData('sit_mathDurationSec', d.mathDurationSec);
       qThis.setEmbeddedData('sit_diffPairsCompleted', d.diffPairsCompleted);
       qThis.setEmbeddedData('sit_diffTeamTotal', d.diffTeamTotal);
       qThis.setEmbeddedData('sit_diffOtherTeamTotal', d.diffOtherTeamTotal);
       qThis.setEmbeddedData('sit_diffOutcome', d.diffOutcome);
       qThis.setEmbeddedData('sit_diffDurationSec', d.diffDurationSec);
       qThis.setEmbeddedData('sit_overallOwnTeamTotal', d.overallOwnTeamTotal);
       qThis.setEmbeddedData('sit_overallOtherTeamTotal', d.overallOtherTeamTotal);
       qThis.setEmbeddedData('sit_overallOutcome', d.overallOutcome);
       qThis.showNextButton();
     });
   });
   ```
   注意：`postMessage`（也就是"下一题"按钮重新出现）只会在**两个任务都做完**之后触发一次，不是任务一做完就触发。
3. 同样要先在Survey Flow里把这些 `sit_xxx` 字段定义成Embedded Data（不需要设置"从URL读取"，这次是JS直接写进去的）

这个方式参与者全程不离开Qualtrics页面，体验更好，但要确保你的Qualtrics账号允许在题目里插入iframe和自定义JS（大多数机构版账号都可以）。

---

## 先自己测试一下

不接Qualtrics也能直接测试这个页面本身：直接打开
```
https://你的用户名.github.io/仓库名/?pid=test&group=A&duration=20&difficulty=easy&diffDuration=30&diffDifficulty=easy&bias=win
```
应该能看到分组、进入任务一（计算），看到模拟队友分数在涨；任务一结束后点"开始任务二"，进入找茬任务，可以自己点两幅图里不一样的地方试试看；两个任务都结束后能看到汇总结果。如果没配 `returnUrl`，结果页会提示"未配置返回地址"，这是正常的，不影响单独测试。
