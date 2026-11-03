# The full study flow (`index.html`)

This is the self-contained, no-backend-required version of the whole study: deploy `index.html` (+ `css/`, `js/`, and `game.html` alongside it) to GitHub Pages and send participants that one link. No Qualtrics required.

```
Entry (Consent + Eligibility)
        ↓
Pre-treatment Demographics (gender / age / education / party ID)
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
Debriefing Statement
        ↓
Data submission (POSTed to a Google Sheet, if configured — see GOOGLE_SHEETS_SETUP.md)
```

Condition 1's task instructions, the Allocation Task, the Q2-Q4 scales, and the comprehension-check questions all use the **exact wording from the KU POLS Annual Survey Proposal** (`jingran_kupolssurvey2026.pdf` in this repo), sections 5.1/5.2. Condition 2 is the three cooperative mini-games already documented in [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) (`game.html`), embedded here via iframe + postMessage.

## Condition 3 — Intergroup Conflict Contest (Experiment 3)

Condition 3 runs the **same `game.html`** as Condition 2 — identical three tasks (Calculation → Spot the Difference → Match Pairs), durations, difficulty and mutual-help rule — switched into contest mode with `contest=group|individual&outcome=win|lose`.

**What contest mode adds**

- **Tug-of-war rope**, pinned at the top of every task screen. One rope spans all three tasks. Each side's pull = Task 1 correct answers × 1 + Task 2 completed picture pairs × 4 + Task 3 cleared boards × 6 (weights in `PULL_WEIGHT` in `js/game.js`, chosen so one unit of work in each task moves the rope a similar amount). Both sides' pull totals and the current lead are always visible.
- **Zero-sum, winner-take-all framing.** Whoever has pulled the rope to their side at the end of Task 3 wins; every member of the winning side gets the bonus, the losing side gets nothing.
- **Scripted opposing side.** The opposing side's score is generated relative to the participant's own side and follows a fixed lead-change script (`CONTEST_SCRIPT`: roughly tied → opponent ahead → participant's side ahead → opponent ahead → participant's side ahead → final stretch), identical for every participant. Only the last 14% differs: it ends in a close loss or a close win, as assigned. The participant's teammates in the group arm score at a neutral pace (`bias` is ignored).
- **Team chat (group arm only)** restricted to five preset messages — no free text, for the participant or the simulated teammates:
  1. Let's go, team! We can do this together!
  2. Don't give up — we can catch up!
  3. Great job, keep it up!
  4. I just helped you — keep going!
  5. Thanks for the help!

  Teammates post on a fixed schedule timed to the script ("catch up" only while behind, "keep it up" only while ahead), reply to the participant's messages with a preset, say #4 when they send the participant a hint, and #5 when the participant helps them. Every message is logged.

**The 2 × 2 within Condition 3** (both factors randomized 50/50, or forced with `contestMode=` / `outcome=`):

| | Win | Lose |
|---|---|---|
| **Group contest** (5-vs-5, help + preset chat) | ① | ② |
| **Individual contest** (1-vs-1, no group, no help, no chat) | ③ | ④ |

**Measures afterward.** Same Allocation Task and scales as the other conditions, with `unlimited` allocation framing by default (so the only difference from Experiment 1's no-conflict baseline is the contest; use `exp3Alloc=fixed10` for the old fixed-10-coin framing). Two contest comprehension checks are added: who receives the reward (winning side only) and whether the participant's side won or lost (scored against the actual result — a manipulation check). In the **individual arm** there is no group: the allocation table is the same 10 people without a Group column, with the contest opponent marked; the identification question is skipped (`identification: null`); `ingroupAffect` = feelings toward the other participants, `outgroupAffect` = feelings toward the contest opponent.

**Outcome guarantee.** A loss can always be enforced at the buzzer. A win cannot be enforced if the participant stops playing while the opposing side is ahead (scores never go down); this is flagged in the payload as `contest.outcomeManipulationOk: false` and those cases should be excluded or analyzed by realized outcome.

## Content that is still a draft — please review before fielding

- **Consent text and the eligibility screen (Entry stage).** This is placeholder language written for development/testing, not IRB-approved wording. It's clearly flagged with a warning banner on the page itself. Edit the `renderEntry()` function near the top of `js/study.js`.
- **Condition 3 bonus payment.** The debrief now discloses that the contest outcome was predetermined and the other participants simulated, and contains a placeholder for how the bonus is actually paid (e.g. to everyone regardless of the result). Fill that in to match your IRB protocol (`renderDebrief()` in `js/study.js`).
- **Debrief contact info.** The debrief statement text is verbatim from the proposal, but the "[researcher contact — add before fielding]" placeholders need your actual contact info (`renderDebrief()` in `js/study.js`).
- **Condition 2's Allocation Task mode.** Condition 2 (Enhanced Belonging) currently uses the same *unlimited*-resources framing as Condition 1, since it isn't testing resource scarcity. If your design actually wants Condition 2 to use the fixed-10-coin framing instead, change the `EXP2_ALLOCATION_MODE` constant near the top of `js/study.js` from `'unlimited'` to `'fixed10'`.
- **Eligibility criteria.** Currently just "18 or older" and "US resident," gating into an in-page "not eligible" message (or a redirect to `disqualifyUrl` if you set one). Add more screening questions in `renderEntry()` if your design needs them.

## URL parameters

| Parameter | Description | Default |
|---|---|---|
| `pid` | Participant ID, echoed back in the final payload | Random |
| `condition` | Force `1`, `2`, or `3` instead of random assignment (useful for testing/preview links, or for piping in a condition Qualtrics/your panel already randomized) | Random (equal thirds) |
| `group` | Force `A` or `B` for the real participant's team | Randomized |
| `ingroup` / `outgroup` | Simulated teammate / opponent counts (the roster size for all three conditions) | 4 / 5 (a 5-vs-5 roster of 10 total, matching the PDF's example) |
| `contestMode` | Condition 3: force `group` or `individual` | Random (50/50) |
| `outcome` | Condition 3: force `win` or `lose` | Random (50/50) |
| `exp3Alloc` | Condition 3: `fixed10` to use the fixed-10-coin allocation framing after the contest | `unlimited` |
| `duration` / `diffDuration` / `linkDuration` / `difficulty` / `diffDifficulty` / `linkDifficulty` / `bias` / `helpThreshold` | Passed straight through to the embedded game for Conditions 2 and 3 (`bias` is ignored in the contest) — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for what each one does | Same as `game.html`, except the three durations default a bit shorter here (120s / 90s / 90s) |
| `help` | Set to `0` to disable the mutual-help mechanic in Condition 2 | On |
| `dataEndpoint` | A Google Apps Script Web App URL that the final payload is POSTed to — see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md) | None (results stay in-page only) |
| `returnUrl` | If set, a "Continue" button appears on the debrief screen that navigates here (e.g. back to a panel vendor's completion URL), carrying `sit_pid` and `sit_condition` | None (a generic "thank you" notice is shown instead) |
| `disqualifyUrl` | If set, participants who fail the eligibility screen are redirected here instead of seeing an in-page message (useful for panel vendors like the one mentioned in the proposal, which expect a specific "terminate" redirect) | None |
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
| `contestMode` / `contestOutcomeAssigned` | Condition 3 only: `group`/`individual` and `win`/`lose` (else `null`) |
| `contest` | Condition 3 only: `{mode, assignedOutcome, realizedOutcome, outcomeManipulationOk, pullWeights, finalPullOwnSide, finalPullOpposingSide, ownSideUnits, opposingSideUnits, leadChanges, trajectory: [{t, task, own, opp}], chat: {log, selfSentTotal, selfSentByMessage} (group arm)}` |
| `group` / `participantLabel` | Assigned team (`A`/`B`) and the participant's own "Participant N" label |
| `rosterSize` | `{total, inGroup, outGroup}` |
| `consentAgreedAt` | ISO timestamp |
| `eligibility` | `{adult, usResident}` |
| `demographics` | `{gender, age, education, party}` — exact option text chosen |
| `game` | `null` for condition 1; for conditions 2 and 3, the **entire** `game.html` result payload (all three tasks' scores, help-given/received counts, roster) — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for its fields |
| `allocationMode` | `unlimited` or `fixed10` |
| `allocation` | `{entries: [{label, groupLabel, isSelf, isOpponent, allocation}], total}` (`groupLabel` is `null` in the Condition 3 individual arm) — one entry per roster member, `allocation` is `'0'`/`'1'`/`'2'`/`'cannot'` |
| `identification` / `ingroupAffect` / `outgroupAffect` | -50 to 50 (Condition 3 individual arm: `identification` is `null`; the two affect fields are toward the other participants / the contest opponent) |
| `comprehension` | `{q5: {prompt, answer, correct}, q6: {...}, ...}` — `q7`/`q8` only present in `fixed10` mode; `qc1` (reward rule) / `qc2` (won or lost) only in Condition 3 |
| `timestamps` | `{enteredAt, demographicsAt, assignedAt, taskStartAt, measuresStartAt, debriefAt}` — ISO strings |
| `userAgent` | `navigator.userAgent`, for basic data-quality screening |
