# How to hook these three cooperative tasks into Qualtrics

> **Note:** as of the full-flow study build, `index.html` is now the self-contained study (Entry → Demographics → Random Assignment → Condition 1/2/3 → Outcome Measures → Debrief — see [STUDY_FLOW.md](./STUDY_FLOW.md)), which embeds the page described on this page as its Condition 2. This document is still accurate for `game.html` — use it if you want to run *just* the three games standalone, embedded in Qualtrics instead of (or alongside) the full study.

The static page `game.html` (+ `css/` + `js/`) presents **three cooperative tasks in sequence**:

1. **Task 1: Cooperative Calculation** — random group display, live scoreboard for simulated teammates/opponents, timed.
2. **Task 2: Spot the Difference** — the same simulated teammates/opponents; the score is how many picture pairs each side fully completes (finding every difference in a pair counts as 1 completed pair; individual differences found don't count on their own).
3. **Task 3: Match Pairs** — the same simulated teammates/opponents; click two matching tiles, and if they can be connected by a path with at most two turns (with nothing blocking in between), they're cleared. Fully clearing a board counts as 1 completed round. The base score is rounds completed; clearing a round faster also earns a per-round speed bonus (the faster the clear, the closer the bonus gets to +1; matching or missing the typical pace earns no bonus, and it never goes negative).

All three tasks use the same random group assignment and the same set of simulated teammates/opponents. Participants complete Task 1, then Task 2, then Task 3, and see a combined summary at the end. Informed consent, instructions, the allocation task, the survey, and the debrief should all live in Qualtrics.

### Mutual help

Within each task, every `helpThreshold` units of the participant's own progress (correct answers / completed diff pairs / cleared link boards — default 5) earns one "help charge". When a charge is available, a **Mutual Help** panel appears listing every in-group teammate by name (e.g. "Help Participant 4") — the participant picks which specific teammate to help; there is no auto-selected target. Spending a charge gives that teammate an extra point on the scoreboard.

In the other direction, teammates periodically send the participant an unprompted hint (roughly every 20-30 seconds per task, randomized): the correct answer in Task 1, a highlighted not-yet-found difference in Task 2, or a highlighted connectable tile pair in Task 3. Every received hint clearly names which teammate sent it (e.g. "Hint from Participant 2: the answer is 42."), shown both as a temporary toast and inline near the task itself, so the participant always knows who helped them. Helps given and received are tracked per task and included in the results payload below. Set `help=0` to turn this mechanic off entirely.

Once deployed, this page's URL will look something like:
```
https://your-username.github.io/repo-name/game.html
```
(In the repository's Settings → Pages, set Source to `Deploy from branch`, branch to `master`, folder to `/ (root)`; it takes 1-2 minutes to go live after saving.)

## URL parameters this page supports

Add `?param=value` to the URL, and chain multiple parameters with `&`:

| Parameter | Description | Default |
|---|---|---|
| `pid` | Participant/response ID, echoed back in the results as-is | Random |
| `group` | Force assignment to `A` or `B` (recommended: let Qualtrics's randomizer decide and pass it in here, so later questions referencing "your group" stay consistent) | Randomized by the page itself if not passed |
| `ingroup` | Number of simulated teammates (excluding the real participant) | 4 |
| `outgroup` | Number of simulated opponents | 5 |
| `duration` | Task 1 (calculation) duration in seconds, minimum 10 | 180 |
| `difficulty` | Task 1 difficulty: `easy` / `medium` / `hard` | medium |
| `diffDuration` | Task 2 (Spot the Difference) duration in seconds, minimum 10 | 120 |
| `diffDifficulty` | Task 2 difficulty: `easy` / `medium` / `hard` (harder = more shapes per picture and more differences to find) | medium |
| `linkDuration` | Task 3 (Match Pairs) duration in seconds, minimum 10 | 150 |
| `linkDifficulty` | Task 3 difficulty: `easy` / `medium` / `hard` (harder = a bigger board and more tile types) | medium |
| `bias` | The simulated teammates'/opponents' tendency across **all three tasks**: `win` / `lose` / `tie` / `random` (a probabilistic tendency, not a guaranteed outcome) | random |
| `help` | Set to `0` to disable the mutual-help mechanic entirely | On |
| `helpThreshold` | How many units of own progress (correct answers / completed diff pairs / cleared link boards) earn one help charge | 5 |
| `helpReceiveInterval` | Seconds between unprompted "receive a hint" events (randomized around this value); mainly useful for shortening the wait during testing | ~20-30s (task-specific) |
| `returnUrl` | Where the "Continue" button on the final results screen navigates to once all three tasks are done (typically your Qualtrics survey URL) | None |
| `autostart` | Set to `1` to skip the "Start" button and go straight into Task 1 (useful for iframe embedding, since Qualtrics already has the instructions). Tasks 2 and 3 still require the participant to click a "Start" button after the previous task finishes | Not skipped |
| `origin` | The `targetOrigin` used when posting the results back to the parent window via postMessage | `*` |
| `debug` | Set to `1` to expose internal state on `window.__sitDebug`, mainly for the automated test suite — not needed for a normal integration | Off |

Result fields produced once all three tasks are complete:

| Field | Meaning |
|---|---|
| `pid` / `group` | Participant ID / assigned group |
| `mathOwnCorrect` | Task 1: number of problems the participant answered correctly |
| `mathTeamTotal` / `mathOtherTeamTotal` | Task 1: own team's total / the other team's total |
| `mathOutcome` | Task 1 result: `win` / `lose` / `tie` |
| `mathDurationSec` | Task 1's actual duration |
| `diffPairsCompleted` | Task 2: number of "Spot the Difference" pairs the participant completed (every difference in a pair must be found for it to count) |
| `diffTeamTotal` / `diffOtherTeamTotal` | Task 2: own team's total completed pairs / the other team's total |
| `diffOutcome` | Task 2 result: `win` / `lose` / `tie` |
| `diffDurationSec` | Task 2's actual duration |
| `linkBoardsCompleted` | Task 3: number of Match Pairs boards the participant fully cleared (base score, excluding the speed bonus) |
| `linkTeamTotal` / `linkOtherTeamTotal` | Task 3: own team's total / the other team's total (includes each member's speed bonus, so may be a decimal) |
| `linkOutcome` | Task 3 result: `win` / `lose` / `tie` |
| `linkDurationSec` | Task 3's actual duration |
| `overallOwnTeamTotal` / `overallOtherTeamTotal` | Combined total across all three tasks: own team / the other team (may be a decimal, since it includes Task 3's speed bonus) |
| `overallOutcome` | The final combined result across all three tasks: `win` / `lose` / `tie` |
| `mathHelpsGiven` / `mathHelpsReceived` | Task 1: number of times the participant helped a teammate / received a hint from one |
| `diffHelpsGiven` / `diffHelpsReceived` | Task 2: same, for Spot the Difference |
| `linkHelpsGiven` / `linkHelpsReceived` | Task 3: same, for Match Pairs |
| `totalHelpsGiven` / `totalHelpsReceived` | Sum of helps given / received across all three tasks |
| `roster` | The full roster (`{id, label, groupLabel, isReal}` per participant) sent via **postMessage only** — a structured array, so it's deliberately excluded from the flat `sit_*` query-string handoff in Method B. Used by the full-flow study (`index.html`) so its post-game Allocation Task can reference the exact same "Participant N" labels the participant just played with. |

---

## Method B: page redirect (recommended to start with — no JavaScript required)

1. In Qualtrics's **Survey Flow**, before the step where participants play the games, add an **Embedded Data** element defining these field names (create them now, leave the values blank): `sit_pid`, `sit_group`, `sit_mathOwnCorrect`, `sit_mathTeamTotal`, `sit_mathOtherTeamTotal`, `sit_mathOutcome`, `sit_mathDurationSec`, `sit_diffPairsCompleted`, `sit_diffTeamTotal`, `sit_diffOtherTeamTotal`, `sit_diffOutcome`, `sit_diffDurationSec`, `sit_linkBoardsCompleted`, `sit_linkTeamTotal`, `sit_linkOtherTeamTotal`, `sit_linkOutcome`, `sit_linkDurationSec`, `sit_overallOwnTeamTotal`, `sit_overallOtherTeamTotal`, `sit_overallOutcome`, `sit_mathHelpsGiven`, `sit_mathHelpsReceived`, `sit_diffHelpsGiven`, `sit_diffHelpsReceived`, `sit_linkHelpsGiven`, `sit_linkHelpsReceived`, `sit_totalHelpsGiven`, `sit_totalHelpsReceived`
2. If you want Qualtrics to decide the group assignment, use Qualtrics's built-in **Randomizer** (or an Embedded Data element with a formula) before this Embedded Data element to generate a `group` field (value `A` or `B`).
3. On the question where participants click through to play the games, insert a hyperlink (via the Rich Content Editor's link tool) pointing to:
   ```
   https://your-username.github.io/repo-name/game.html?pid=${e://Field/ResponseID}&group=${e://Field/group}&duration=180&diffDuration=120&linkDuration=150&returnUrl=https://your-datacenter.qualtrics.com/jfe/form/SV_your-survey-id
   ```
   (`${e://Field/xxx}` is Qualtrics's "piped text" syntax and gets substituted with the real value automatically; `SV_your-survey-id` can be found in the survey's distribution link.)
4. Clicking this link takes the participant **away** from Qualtrics to play Task 1 (calculation), then Task 2 (Spot the Difference), then Task 3 (Match Pairs) in order — a "Start next task" button appears after each one finishes. Once all three are done, the "Continue" button on the results screen appends all the result fields to the `returnUrl` you configured and navigates there.
5. Since it's the same browser/same tab navigating back, Qualtrics will typically pick up right where the participant left off using its session cookie (as long as "Save and Continue" hasn't been disabled — it's on by default).
6. The URL Qualtrics receives back will carry parameters like `sit_mathOwnCorrect=12&sit_diffPairsCompleted=3&sit_linkBoardsCompleted=4&sit_overallOutcome=lose`. If each of the Embedded Data fields you defined in step 1 is set to "read from URL" (the Embedded Data element's settings have a "Set Value from URL/Cookie" option — set the source to URL parameter, with the parameter name matching `sit_xxx`), Qualtrics will automatically store the value when it loads that URL.

The upside of this method is that it requires no code at all; the downside is that it depends on the participant's browser retaining the session cookie normally (this is fine in the vast majority of cases).

## Method A: iframe embed + postMessage (smoother experience, requires a short JS snippet)

1. Insert an iframe into the question (switch the Rich Content Editor to HTML source mode):
   ```html
   <iframe id="sitGame" src="https://your-username.github.io/repo-name/game.html?pid=${e://Field/ResponseID}&group=${e://Field/group}&duration=180&diffDuration=120&linkDuration=150&autostart=1" width="100%" height="750" style="border:none;"></iframe>
   ```
   `autostart=1` only skips the "Start" button before Task 1; after each task finishes, the participant still needs to click a "Start next task" button inside the iframe to continue (this is intentional, so participants get a moment to catch their breath and see the previous task's result) — no extra configuration is needed for this.
2. Click the gear icon on this question → **Add JavaScript**, and paste:
   ```javascript
   Qualtrics.SurveyEngine.addOnload(function() {
     var qThis = this;
     qThis.hideNextButton(); // hide the "Next" button until all three tasks are done
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
       qThis.setEmbeddedData('sit_linkBoardsCompleted', d.linkBoardsCompleted);
       qThis.setEmbeddedData('sit_linkTeamTotal', d.linkTeamTotal);
       qThis.setEmbeddedData('sit_linkOtherTeamTotal', d.linkOtherTeamTotal);
       qThis.setEmbeddedData('sit_linkOutcome', d.linkOutcome);
       qThis.setEmbeddedData('sit_linkDurationSec', d.linkDurationSec);
       qThis.setEmbeddedData('sit_overallOwnTeamTotal', d.overallOwnTeamTotal);
       qThis.setEmbeddedData('sit_overallOtherTeamTotal', d.overallOtherTeamTotal);
       qThis.setEmbeddedData('sit_overallOutcome', d.overallOutcome);
       qThis.setEmbeddedData('sit_mathHelpsGiven', d.mathHelpsGiven);
       qThis.setEmbeddedData('sit_mathHelpsReceived', d.mathHelpsReceived);
       qThis.setEmbeddedData('sit_diffHelpsGiven', d.diffHelpsGiven);
       qThis.setEmbeddedData('sit_diffHelpsReceived', d.diffHelpsReceived);
       qThis.setEmbeddedData('sit_linkHelpsGiven', d.linkHelpsGiven);
       qThis.setEmbeddedData('sit_linkHelpsReceived', d.linkHelpsReceived);
       qThis.setEmbeddedData('sit_totalHelpsGiven', d.totalHelpsGiven);
       qThis.setEmbeddedData('sit_totalHelpsReceived', d.totalHelpsReceived);
       qThis.showNextButton();
     });
   });
   ```
   Note: the `postMessage` (i.e. the "Next" button reappearing) only fires once, after **all three tasks** are finished — not after Task 1 alone.
3. As with Method B, define these `sit_xxx` fields as Embedded Data in the Survey Flow first (no need to set "read from URL" this time, since the JS writes them directly).

With this method, participants never leave the Qualtrics page, which is a smoother experience — just make sure your Qualtrics account allows inserting iframes and custom JavaScript into questions (most institutional accounts do).

---

## Test it yourself first

You can test this page on its own without connecting it to Qualtrics — just open:
```
https://your-username.github.io/repo-name/game.html?pid=test&group=A&duration=20&difficulty=easy&diffDuration=30&diffDifficulty=easy&linkDuration=40&linkDifficulty=easy&bias=win
```
You should see the group assignment, then Task 1 (calculation) with simulated teammates' scores ticking up; after Task 1 ends, click "Start Task 2" to enter Spot the Difference, where you can click the differences between the two pictures yourself; after Task 2 ends, click "Start Task 3" to enter Match Pairs, where you can click two matching tiles to see if they clear; once all three tasks are done you'll see the combined results. If `returnUrl` isn't configured, the results screen will note that no return address is set — that's expected and doesn't affect standalone testing.
