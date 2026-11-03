# The full study flow (`index.html`)

This is the self-contained, no-backend-required version of the whole study: deploy `index.html` (+ `css/`, `js/`, and `game.html` alongside it) to GitHub Pages and send participants that one link. No Qualtrics required.

```
Entry (Consent + Eligibility)
        ↓
Random Assignment  ──┬── 1/3 ──→ Condition 1: Group Label (control)
                      ├── 1/3 ──→ Condition 2: Enhanced Belonging (the 3 games)
                      └── 1/3 ──→ Condition 3: Intergroup Conflict Contest
                                     (2 x 2: group/individual contest x win/lose)
        ↓ (all three converge here)
Common Outcome Measurements
  Q1 Allocation Task · Q2 Identification · Q3 In-Group Affect · Q4 Out-Group Affect
  + a comprehension check (wording depends on the condition)
        ↓
Background questions (gender / age / education / party ID)
        ↓
Debriefing Statement
        ↓
Data submission (POSTed to a Google Sheet, if configured — see GOOGLE_SHEETS_SETUP.md)
```

Participants go from consent straight into their assigned task; the background questions are asked at the end, after the comprehension check. (Note: because they now come after the treatment, party ID could in principle be affected by it — treat demographics as covariates measured post-treatment.)

Condition 1's task instructions, the Allocation Task, the Q2-Q4 scales, and the comprehension-check questions all use the **exact wording from the KU POLS Annual Survey Proposal** (`jingran_kupolssurvey2026.pdf` in this repo), sections 5.1/5.2. Condition 2 is the three cooperative mini-games already documented in [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) (`game.html`), embedded here via iframe + postMessage.

**Random assignment happens once.** Condition, group (A/B), participant labels, and — in Condition 3 — contest arm, Rounds 1–2 order and final-round result are all assigned at the "Random Assignment" step and carried unchanged through the task, the Allocation Task and the questions. Conditions 2 and 3 allocate over the exact roster the participant just played with (the individual arm uses its own ungrouped 10-person roster, with the same self and opponent labels shown in the contest). Nothing is re-randomized at the measures stage.

**Allocation scenario.** Condition 1 reads the scenario (community decision-making, gold coins) on its task-instructions screen. Conditions 2 and 3 read the same scenario at the top of the Allocation Task, after the games, worded "you and the other participants" in the individual arm and noting that the gold coins are separate from the contest points.

## Condition 3 — Intergroup Conflict Contest (Experiment 3)

Condition 3 runs the **same `game.html`** as Condition 2 — identical three tasks (Calculation → Spot the Difference → Match Pairs), durations, difficulty and mutual-help rule — switched into contest mode with `contest=group|individual&outcome=win|lose&order=WL|LW`.

**What contest mode adds**

- **Three rounds, each its own tug-of-war.** Round 1 = Calculation, Round 2 = Spot the Difference, Round 3 = Match Pairs. The rope (pinned at the top of every task screen) is driven by that round's counts: correct answers / completed picture pairs / matched tile pairs (in the contest, Match Pairs is scored per matched pair rather than per cleared board, so the rope moves with every match). The side ahead when the round's time runs out wins the round.
- **Points (zero-sum).** Everyone starts with **10 points**. In Rounds 1 and 2, each member of the losing side gives **5 points** to the winning side. **Round 3 is winner-takes-all**: the losing side gives all of its points to the winning side. Both sides' points are always visible under the rope, and every between-round screen shows the round result and the transfer. ("Points" rather than "coins", to keep them distinct from the gold coins in the Allocation Task.)
- **Assigned outcomes.** Rounds 1–2 are always **one win and one loss**; the order is counterbalanced (`order=WL` win-then-lose or `order=LW` lose-then-win, randomized 50/50). So both sides are tied at 10–10 going into Round 3. The **Round 3 result is randomized** (`outcome=win|lose`, 50/50) and decides everything: final points are 20 vs 0 or 0 vs 20.
- **Opposing team members score individually.** Each simulated opponent has their own fixed pace, and every point the opposing side scores goes to one member drawn at random in proportion to that pace, so the per-member counts on the scoreboard rise irregularly, like the participant's own teammates (stored per round in `contest.rounds` totals and `oppMember` in debug state).
- **Scripted opposing side, with back-and-forth.** Within each round the opposing side's score is generated relative to the participant's side and follows a fixed lead-change script (`ROUND_SCRIPT` in `js/game.js`: close → opponent ahead → participant's side ahead → close again → final stretch), identical for every participant. In the final quarter of the round the opposing side either stops gaining (assigned win) or pulls away (assigned loss). Teammates in the group arm score at a neutral pace (`bias` is ignored).
- **End-of-round screen.** After each round (including the final one), the same fixed layout shows the round result in the center with an **animation of the points moving** from the losing side to the winning side, one at a time: the loser's counter ticks down, the winner's ticks up, and the change is shown as −5 / +5 (−10 / +10 in the winner-takes-all final). The button to continue unlocks when the animation ends. The round's final scoreboard is on the right (left in the individual arm).
- **Reaction chat on the end-of-round screen (group arm only).** The team chat stays on the left with five reaction presets that depend on the result — e.g. after a loss "Oh no, we lost this one. 😞", "Ugh, that was so close!", "That hurts…", "Don't worry, team — we'll do better next round!", "Let's stick together."; after a win "We did it! 🎉", "Great teamwork, everyone!", etc.; slightly different wording after the final round (`REACTION_PRESETS` in `js/game.js`). Teammates post three reactions on a fixed schedule (`REACTION_SCHEDULE`) and reply to the participant's; none mentions the other team. Each chat log entry records the `phase` it was sent in (`math`/`diff`/`link` = during play, `math_done`/`diff_done`/`results` = end-of-round screens).
- **Fixed, non-scrolling game screen (desktop).** During each round the page doesn't scroll: the rope is pinned on top, the task is in the center, the team chat is on the left, and the mutual-help panel plus the live scoreboard are on the right, so participants see teammates' encouragement and help while they play. In the individual arm the scoreboard is on the left and there is no chat or help. On narrow screens (under 1000px wide, or under 560px tall) the panels stack and the page scrolls as usual. The study page gives the game the full browser window for this stage.
- **Team chat (group arm only)** restricted to five preset messages — no free text, for the participant or the simulated teammates:
  1. Let's go, team! We can do this together!
  2. Don't give up — we can catch up!
  3. Great job, keep it up!
  4. I just helped you — keep going!
  5. Thanks for the help!

  Teammates post on a fixed per-round schedule timed to the script ("catch up" only while behind, "keep it up" only while ahead), reply to the participant's messages with a preset, say #4 when they send the participant a hint, and #5 when the participant helps them. Every message is logged.

**The 2 × 2 within Condition 3** (both factors randomized 50/50, or forced with `contestMode=` / `outcome=`):

| | Final round won (20 : 0) | Final round lost (0 : 20) |
|---|---|---|
| **Group contest** (5-vs-5, help + preset chat) | ① | ② |
| **Individual contest** (1-vs-1, no group, no help, no chat) | ③ | ④ |

Rounds 1–2 order (WL / LW) is counterbalanced within every cell and can be pooled or included as a control.

**Measures afterward.** Same Allocation Task and scales as the other conditions, with `unlimited` allocation framing by default (so the only difference from Experiment 1's no-conflict baseline is the contest; use `exp3Alloc=fixed10` for the old fixed-10-coin framing). Two contest comprehension checks are added: what happens to the losing side's points in the final round (the winner takes all) and whether the participant's side won or lost the final round (scored against the actual result — a manipulation check). In the **individual arm** there is no group: the allocation table is the same 10 people without a Group column, with the contest opponent marked; the identification question is skipped (`identification: null`); `ingroupAffect` = feelings toward the other participants, `outgroupAffect` = feelings toward the contest opponent.

**Outcome guarantee.** An assigned loss can always be enforced at the buzzer. An assigned win cannot be if the participant stops playing while the opposing side is ahead (scores never go down); that round is then recorded with its actual result (points transfer accordingly) and flagged via `contest.outcomeManipulationOk: false`. Exclude those cases or analyze by realized outcome (`contest.rounds[i].realizedOutcome`, `contest.realizedOutcome`). In the group arm an assigned win is always secured (a simulated teammate scores at the buzzer if needed), so this can only arise in the individual arm.

## Content that is still a draft — please review before fielding

- **Consent text and the eligibility screen (Entry stage).** This is placeholder language written for development/testing, not IRB-approved wording. It's clearly flagged with a warning banner on the page itself. Edit the `renderEntry()` function near the top of `js/study.js`.
- **Condition 3 bonus payment.** The debrief now discloses that the contest outcome was predetermined and the other participants simulated, and contains a placeholder for how the bonus is actually paid (e.g. to everyone regardless of the result). Fill that in to match your IRB protocol (`renderDebrief()` in `js/study.js`).
- **Debrief contact info.** The debrief statement text is verbatim from the proposal, but the "[researcher contact — add before fielding]" placeholders need your actual contact info (`renderDebrief()` in `js/study.js`).
- **Condition 2's Allocation Task mode.** Condition 2 (Enhanced Belonging) currently uses the same *unlimited*-resources framing as Condition 1, since it isn't testing resource scarcity. If your design actually wants Condition 2 to use the fixed-10-coin framing instead, change the `EXP2_ALLOCATION_MODE` constant near the top of `js/study.js` from `'unlimited'` to `'fixed10'`.
- **Computer-only check.** Phones and tablets (touch-only input or a mobile user agent) are stopped on the first screen with a "Please use a computer" message, because Experiment 3's side panels need a desktop/laptop screen. The payload's `device` field records what was detected. Mention the computer requirement in your recruitment text too.
- **Eligibility criteria.** Currently just "18 or older" and "US resident," gating into an in-page "not eligible" message (or a redirect to `disqualifyUrl` if you set one). Add more screening questions in `renderEntry()` if your design needs them.

## URL parameters

| Parameter | Description | Default |
|---|---|---|
| `pid` | Participant ID, echoed back in the final payload | Random |
| `condition` | Force `1`, `2`, or `3` instead of random assignment (useful for testing/preview links, or for piping in a condition Qualtrics/your panel already randomized) | Random (equal thirds) |
| `group` | Force `A` or `B` for the real participant's team | Randomized |
| `ingroup` / `outgroup` | Simulated teammate / opponent counts (the roster size for all three conditions) | 4 / 5 (a 5-vs-5 roster of 10 total, matching the PDF's example) |
| `contestMode` | Condition 3: force `group` or `individual` | Random (50/50) |
| `outcome` | Condition 3: force the final round (Round 3) result, `win` or `lose` | Random (50/50) |
| `order` | Condition 3: force the Rounds 1–2 order, `WL` or `LW` | Random (50/50) |
| `exp3Alloc` | Condition 3: `fixed10` to use the fixed-10-coin allocation framing after the contest | `unlimited` |
| `duration` / `diffDuration` / `linkDuration` / `difficulty` / `diffDifficulty` / `linkDifficulty` / `bias` / `helpThreshold` | Passed straight through to the embedded game for Conditions 2 and 3 (`bias` is ignored in the contest) — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for what each one does | Same as `game.html`, except the durations: Calculation 120s, Spot the Difference 150s, Match Pairs 180s (shared by Conditions 2 and 3, so the two experiments differ only in the contest) |
| `help` | Set to `0` to disable the mutual-help mechanic in Condition 2 | On |
| `dataEndpoint` | A Google Apps Script Web App URL that the final payload is POSTed to — see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md) | None (results stay in-page only) |
| `returnUrl` | If set, a "Continue" button appears on the debrief screen that navigates here (e.g. back to a panel vendor's completion URL), carrying `sit_pid` and `sit_condition` | None (a generic "thank you" notice is shown instead) |
| `disqualifyUrl` | If set, participants who fail the eligibility screen are redirected here instead of seeing an in-page message (useful for panel vendors like the one mentioned in the proposal, which expect a specific "terminate" redirect) | None |
| `allowMobile` | `1` skips the computer-only check (for previewing on a phone). Without it, phones and tablets see a "Please use a computer" screen and cannot start | Off |
| `debug` | `1` exposes `window.__studyDebug` with internal state (`.state`, `.CONFIG`) — used by the automated test suite, and handy for manually inspecting `window.__studyDebug.state.finalPayload` after reaching debrief | Off |

## Testing it yourself

```
node test/static_server.js
```
then open `http://localhost:8099/?debug=1`, or force a specific arm: `...?condition=1&debug=1`, `...?condition=2&debug=1`, `...?condition=3&contestMode=group&outcome=lose&debug=1` (any of the four contest arms).

`node test/playwright_check.js` (with the static server running) exercises all three conditions end-to-end automatically, including playing all four Condition 3 contest arms at a human-like pace (about 2 minutes, run in parallel).

## The final data payload

Assembled once the participant reaches the debrief screen, and (if `dataEndpoint` is set) POSTed there as JSON at that point — see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md) for how to turn that into Sheet rows automatically.

| Field | Meaning |
|---|---|
| `pid` | Participant ID |
| `condition` / `conditionName` | `1`/`2`/`3` and `group_label_control` / `enhanced_belonging` / `intergroup_conflict_contest` |
| `contestMode` / `contestOutcomeAssigned` / `contestOrder` | Condition 3 only: `group`/`individual`, the final-round result `win`/`lose`, and the Rounds 1–2 order `WL`/`LW` (else `null`) |
| `contest` | Condition 3 only: `{mode, order, assignedOutcomes: {round1, round2, round3}, assignedOutcome, realizedOutcome, outcomeManipulationOk, startingPoints, roundStake, finalPointsOwn, finalPointsOpposing, rounds: [{round, task, assignedOutcome, realizedOutcome, ownSideScore, opposingSideScore, leadChanges, pointsTransferred, pointsBefore, pointsAfter}], trajectory: [{round, t, own, opp}], chat: {log, selfSentTotal, selfSentByMessage} (group arm)}` |
| `group` / `participantLabel` | Assigned team (`A`/`B`) and the participant's own "Participant N" label |
| `rosterSize` | `{total, inGroup, outGroup}` |
| `consentAgreedAt` | ISO timestamp |
| `eligibility` | `{adult, usResident}` |
| `demographics` | `{gender, age, education, party}` — exact option text chosen |
| `game` | `null` for condition 1; for conditions 2 and 3, the **entire** `game.html` result payload (all three tasks' scores, help-given/received counts, roster) — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for its fields |
| `allocationMode` | `unlimited` or `fixed10` |
| `allocation` | `{entries: [{label, groupLabel, isSelf, isOpponent, allocation}], total}` (`groupLabel` is `null` in the Condition 3 individual arm) — one entry per roster member, `allocation` is `'0'`/`'1'`/`'2'`/`'cannot'` |
| `identification` / `ingroupAffect` / `outgroupAffect` | -50 to 50 (Condition 3 individual arm: `identification` is `null`; the two affect fields are toward the other participants / the contest opponent) |
| `comprehension` | `{q5: {prompt, answer, correct}, q6: {...}, ...}` — `q7`/`q8` only present in `fixed10` mode; `qc1` (final round is winner-takes-all) / `qc2` (won or lost the final round) only in Condition 3 |
| `timestamps` | `{enteredAt, demographicsAt, assignedAt, taskStartAt, measuresStartAt, debriefAt}` — ISO strings |
| `userAgent` | `navigator.userAgent`, for basic data-quality screening |
| `device` | `{mobileDetected, viewport: {w, h}, screen: {w, h}}` |
