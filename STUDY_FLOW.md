# The full study flow (`index.html`)

This is the self-contained, no-backend-required version of the whole study: deploy `index.html` (+ `css/`, `js/`, and `game.html` alongside it) to GitHub Pages and send participants that one link. No Qualtrics required.

```
Entry (Consent + Eligibility)
        ↓
Pre-treatment Demographics (gender / age / education / party ID)
        ↓
Random Assignment  ──┬── 1/3 ──→ Condition 1: Group Label (control)
                      ├── 1/3 ──→ Condition 2: Enhanced Belonging (the 3 games)
                      └── 1/3 ──→ Condition 3: Conflict Moderator (treatment 1)
        ↓ (all three converge here)
Common Outcome Measurements
  Q1 Allocation Task · Q2 Identification · Q3 In-Group Affect · Q4 Out-Group Affect
  + a comprehension check (wording depends on the condition)
        ↓
Debriefing Statement
        ↓
Data submission (POSTed to a Google Sheet, if configured — see GOOGLE_SHEETS_SETUP.md)
```

Conditions 1 and 3's task instructions, the Allocation Task, the Q2-Q4 scales, and the comprehension-check questions all use the **exact wording from the KU POLS Annual Survey Proposal** (`jingran_kupolssurvey2026.pdf` in this repo), sections 5.1 (Condition 1 / "Control") and 5.2 (Condition 3 / "Treatment 1"). Condition 2 is the three cooperative mini-games already documented in [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) (`game.html`), embedded here via iframe + postMessage so none of that already-tested game code needed to change.

## Content that is still a draft — please review before fielding

- **Consent text and the eligibility screen (Entry stage).** This is placeholder language written for development/testing, not IRB-approved wording. It's clearly flagged with a warning banner on the page itself. Edit the `renderEntry()` function near the top of `js/study.js`.
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
| `duration` / `diffDuration` / `linkDuration` / `difficulty` / `diffDifficulty` / `linkDifficulty` / `bias` / `helpThreshold` | Passed straight through to the embedded game for Condition 2 — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for what each one does | Same as `game.html`, except the three durations default a bit shorter here (120s / 90s / 90s) |
| `help` | Set to `0` to disable the mutual-help mechanic in Condition 2 | On |
| `dataEndpoint` | A Google Apps Script Web App URL that the final payload is POSTed to — see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md) | None (results stay in-page only) |
| `returnUrl` | If set, a "Continue" button appears on the debrief screen that navigates here (e.g. back to a panel vendor's completion URL), carrying `sit_pid` and `sit_condition` | None (a generic "thank you" notice is shown instead) |
| `disqualifyUrl` | If set, participants who fail the eligibility screen are redirected here instead of seeing an in-page message (useful for panel vendors like the one mentioned in the proposal, which expect a specific "terminate" redirect) | None |
| `debug` | `1` exposes `window.__studyDebug` with internal state (`.state`, `.CONFIG`) — used by the automated test suite, and handy for manually inspecting `window.__studyDebug.state.finalPayload` after reaching debrief | Off |

## Testing it yourself

```
node test/static_server.js
```
then open `http://localhost:8099/?debug=1`, or force a specific arm: `...?condition=1&debug=1`, `...?condition=2&debug=1`, `...?condition=3&debug=1`.

`node test/playwright_check.js` (with the static server running) exercises all three conditions end-to-end automatically, including deliberately over-allocating past the 10-coin cap in Condition 3 to verify it's blocked.

## The final data payload

Assembled once the participant reaches the debrief screen, and (if `dataEndpoint` is set) POSTed there as JSON at that point — see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md) for how to turn that into Sheet rows automatically.

| Field | Meaning |
|---|---|
| `pid` | Participant ID |
| `condition` / `conditionName` | `1`/`2`/`3` and `group_label_control` / `enhanced_belonging` / `conflict_moderator_treatment1` |
| `group` / `participantLabel` | Assigned team (`A`/`B`) and the participant's own "Participant N" label |
| `rosterSize` | `{total, inGroup, outGroup}` |
| `consentAgreedAt` | ISO timestamp |
| `eligibility` | `{adult, usResident}` |
| `demographics` | `{gender, age, education, party}` — exact option text chosen |
| `game` | `null` for conditions 1/3; for condition 2, the **entire** `game.html` result payload (all three tasks' scores, help-given/received counts, roster) — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for its fields |
| `allocationMode` | `unlimited` or `fixed10` |
| `allocation` | `{entries: [{label, groupLabel, isSelf, allocation}], total}` — one entry per roster member, `allocation` is `'0'`/`'1'`/`'2'`/`'cannot'` |
| `identification` / `ingroupAffect` / `outgroupAffect` | -50 to 50 |
| `comprehension` | `{q5: {prompt, answer, correct}, q6: {...}, ...}` — `q7`/`q8` only present in `fixed10` mode |
| `timestamps` | `{enteredAt, demographicsAt, assignedAt, taskStartAt, measuresStartAt, debriefAt}` — ISO strings |
| `userAgent` | `navigator.userAgent`, for basic data-quality screening |
