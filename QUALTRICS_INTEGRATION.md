# 如何把这个计算任务接入 Qualtrics

这个仓库根目录下的静态页面（`index.html` + `css/` + `js/`）只负责一件事：**呈现"计算比赛"这个环节**——随机分组展示、模拟队友/对方队伍实时比分、计时。知情同意、说明、分配任务、问卷、debrief 都应该留在 Qualtrics 里完成。

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
| `duration` | 任务时长（秒） | 180 |
| `difficulty` | `easy` / `medium` / `hard` | medium |
| `bias` | 模拟队友/对手进度的倾向：`win` / `lose` / `tie` / `random`（概率性倾向，不是精确保数） | random |
| `returnUrl` | 任务结束后"继续"按钮要跳转回的地址（一般填Qualtrics问卷的网址） | 无 |
| `autostart` | 填 `1` 则跳过"开始"按钮，打开页面直接进入任务（适合iframe嵌入场景，因为Qualtrics那边已经有说明了） | 不跳过 |

任务结束后产出的结果字段：`pid`、`group`、`ownCorrect`（自己答对几题）、`ownTeamTotal`（本队总分）、`otherTeamTotal`（对方总分）、`outcome`（`win`/`lose`/`tie`）、`durationSec`。

---

## 方式 B：网页跳转（推荐先用这个，不需要写JS）

1. 在Qualtrics的 **Survey Flow** 里，游戏这一步之前加一个 **Embedded Data** 元素，定义好这些字段名（先建好，值先留空）：`sit_ownCorrect`、`sit_ownTeamTotal`、`sit_otherTeamTotal`、`sit_outcome`、`sit_group`、`sit_pid`、`sit_durationSec`
2. 如果你想让Qualtrics决定分组，在这个Embedded Data前用Qualtrics自带的 **Randomizer**（或者用Embedded Data配合公式）生成一个 `group` 字段（值为 A 或 B）
3. 在需要跳转去玩游戏的那道题里，插入一个超链接（Rich Content Editor 里插入链接），地址填：
   ```
   https://你的用户名.github.io/仓库名/?pid=${e://Field/ResponseID}&group=${e://Field/group}&duration=180&returnUrl=https://你的数据中心.qualtrics.com/jfe/form/SV_你的问卷ID
   ```
   （`${e://Field/xxx}` 是Qualtrics的"管道文本"写法，会自动替换成实际值；`SV_你的问卷ID` 在问卷的分发链接里能找到）
4. 参与者点这个链接会**离开**Qualtrics页面去玩游戏（同一个标签页跳转），玩完后页面上的"继续"按钮会带着结果参数跳回你在 `returnUrl` 填的这个问卷地址
5. 因为是同一个浏览器/同一个标签页跳回来，Qualtrics通常会凭浏览器里的进度cookie自动接着上次的进度继续（前提是没关掉"Save and Continue"这个功能，默认是开的）
6. 跳回来的网址会带 `sit_ownCorrect=12&sit_outcome=lose` 这样的参数，如果你在第1步定义的Embedded Data字段设置成"从URL读取"（Embedded Data元素设置里有个"Set Value from URL/Cookie"的选项，把来源设为URL parameter，参数名填 `sit_ownCorrect` 对应 `sit_ownCorrect`），Qualtrics加载这个网址时就会自动把值存进去

这个方式的好处是完全不用写代码，缺点是参与者的浏览器要能正常保留session cookie（正常情况下没问题）。

## 方式 A：iframe嵌入 + postMessage（体验更流畅，需要贴一段JS）

1. 在题目里插入一个iframe（Rich Content Editor切到HTML源码模式）：
   ```html
   <iframe id="sitGame" src="https://你的用户名.github.io/仓库名/?pid=${e://Field/ResponseID}&group=${e://Field/group}&duration=180&autostart=1" width="100%" height="700" style="border:none;"></iframe>
   ```
2. 点这道题右上角的齿轮图标 → **Add JavaScript**，粘贴：
   ```javascript
   Qualtrics.SurveyEngine.addOnload(function() {
     var qThis = this;
     qThis.hideNextButton(); // 玩完之前先隐藏"下一题"按钮
     window.addEventListener('message', function (event) {
       if (!event.data || event.data.type !== 'sit_task_complete') return;
       var d = event.data.payload;
       qThis.setEmbeddedData('sit_pid', d.pid);
       qThis.setEmbeddedData('sit_group', d.group);
       qThis.setEmbeddedData('sit_ownCorrect', d.ownCorrect);
       qThis.setEmbeddedData('sit_ownTeamTotal', d.ownTeamTotal);
       qThis.setEmbeddedData('sit_otherTeamTotal', d.otherTeamTotal);
       qThis.setEmbeddedData('sit_outcome', d.outcome);
       qThis.setEmbeddedData('sit_durationSec', d.durationSec);
       qThis.showNextButton();
     });
   });
   ```
3. 同样要先在Survey Flow里把这些 `sit_xxx` 字段定义成Embedded Data（不需要设置"从URL读取"，这次是JS直接写进去的）

这个方式参与者全程不离开Qualtrics页面，体验更好，但要确保你的Qualtrics账号允许在题目里插入iframe和自定义JS（大多数机构版账号都可以）。

---

## 先自己测试一下

不接Qualtrics也能直接测试这个页面本身：直接打开
```
https://你的用户名.github.io/仓库名/?pid=test&group=A&duration=20&difficulty=easy&bias=win
```
应该能看到分组、进游戏、看到模拟队友分数在涨、最后看到结果。如果没配 `returnUrl`，结果页会提示"未配置返回地址"，这是正常的，不影响单独测试。
