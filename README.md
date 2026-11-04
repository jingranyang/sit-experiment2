# SIT Group Identity Behavioral Experiment

Reexamining Social Identity Theory's causal foundations: does group identity alone produce discrimination and negative out-group attitudes, or does that require intergroup conflict (resource scarcity) on top of it? See `jingran_kupolssurvey2026.pdf` (KU POLS Annual Survey Proposal) for the full research design this site implements.

## `index.html` — the full study (start here)

A **fully static, no-server-required** site, deployable directly on GitHub Pages, that runs the entire participant journey end to end — no Qualtrics required:

**Participant Entry** (consent + eligibility) → **Random assignment** to one of three conditions → **Common Outcome Measurements** (Allocation Task + group identification + in-group/out-group affect + a comprehension check) → **Background questions** (demographics) → **Debrief**.

The three experimental conditions:

1. **Group Label** (control) — participants are just told their group (A or B) and asked to allocate an *unlimited* supply of gold coins among the 10 participants in their round. No conflict, no game — isolates the effect of group identity alone.
2. **Enhanced Belonging** — the three cooperative mini-games (Cooperative Calculation, Spot the Difference, Match Pairs), including the mutual-help mechanic, embedded as an iframe. Tests whether actively *reinforcing* group belonging changes the identity effect.
3. **Intergroup Conflict Contest** (Experiment 3) — the *same three games* as condition 2 (`game.html`), switched into contest mode: **three rounds, each a zero-sum tug-of-war** decided by how many problems each side solves in that round. Everyone starts with 10 points; in Rounds 1–2 each member of the losing side gives 5 points to the winners; **Round 3 is winner-takes-all**. Within this condition, participants are randomized:
   - **Group** (treatment) vs. **Individual** (control) contest. Group = 5-vs-5 teams with the mutual-help mechanic and a team chat restricted to 5 preset, in-group-encouragement-only messages. Individual = the same contest one-on-one against a single opponent, with no group label, no teammates, no help and no chat.
   - **Final round won** vs. **lost** (20 : 0 or 0 : 20 points). Rounds 1–2 are always one win and one loss (order counterbalanced), so the sides are tied 10–10 going into Round 3. The opposing side is computer-driven and follows a fixed lead-change script within each round, so the lead swings back and forth.

   Then the same Allocation Task and measures (in the individual arm the table has no Group column, the identification question is skipped, and the affect questions ask about the other participants vs. the contest opponent). See [STUDY_FLOW.md](./STUDY_FLOW.md) for details.

Condition 1's instructions, and the allocation task, identification/affect scales, and comprehension-check questions, use the exact wording from the KU POLS proposal (sections 5.1/5.2). Condition 3 uses the fixed-10-coin (scarce resources) allocation after the contest; `?exp3Alloc=unlimited` switches it to the unlimited framing. The consent text in the Entry stage is **placeholder language only** — it has not been IRB-reviewed; replace it before fielding a real study (see the in-page warning banner and comments at the top of `js/study.js`).

- Supported URL parameters, the final data payload shape, and all assumptions worth double-checking: see [STUDY_FLOW.md](./STUDY_FLOW.md)
- Saving results to Google Sheets: see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md)
- Local testing: `node test/static_server.js`, then open `http://localhost:8099/?debug=1` (add `&condition=1`, `2`, or `3` to force a specific arm instead of random assignment; for condition 3 also `&contestMode=group|individual&outcome=win|lose&order=WL|LW`)
- Automated tests: with the static server running, `node test/playwright_check.js` — covers the three-game engine itself *and* the full Entry → Debrief flow for all three conditions, including all four Condition-3 contest arms (outcome manipulation, lead changes, preset-only chat, help, payload) and the Condition-2 iframe hand-off.

## `game.html` — the three games on their own (legacy / Qualtrics-embed use)

The original single-page version of just the three cooperative mini-games (Cooperative Calculation, Spot the Difference, Match Pairs, with the mutual-help mechanic), unchanged. `index.html`'s Conditions 2 and 3 both embed this exact page via iframe (Condition 3 adds `contest=group|individual&outcome=win|lose&order=WL|LW`; without those parameters the page behaves exactly as before). It's also still fully usable on its own if you ever want to run *just* the games embedded in Qualtrics (or anywhere else) instead of the full study flow above — see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md) for that integration path, its URL parameters, and the result fields it produces.

## `server-version/`: full standalone version with its own backend

A more full-featured, older version with its own Node.js backend: a waiting room / instant-start flow, random group assignment, an admin interface (create studies, monitor progress, export CSV), and the complete allocation-task and survey flow are all built into this one codebase. Zero external dependencies (`node server.js`), deployable to a platform like Render or Railway. Superseded for most purposes by `index.html` above, which needs no backend at all; kept here for reference. See the code in that directory for details.
