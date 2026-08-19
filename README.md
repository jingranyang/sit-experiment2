# SIT Group Identity Behavioral Experiment — Cooperative Tasks

This repository contains two versions, for two different use cases:

## Root directory: static version (for use with Qualtrics, recommended)

`index.html` + `css/` + `js/` is a **fully static, no-server-required** page that can be deployed directly on GitHub Pages. It presents three cooperative tasks in sequence: first "Cooperative Calculation" (random group assignment, live scoreboard of simulated teammates/opponents, timed), then "Spot the Difference" (the same simulated teammates/opponents, competing on how many picture pairs each side fully completes), and finally "Match Pairs" (click two matching tiles, connect them with a path of at most two turns to clear them, competing on how many boards each side clears — with an extra speed bonus for clearing faster). Informed consent, the allocation task, the survey, and the debrief are all handled in Qualtrics.

- Deployment steps, supported URL parameters, how to integrate with Qualtrics (either iframe+postMessage or a page-redirect handoff), and the result fields produced after all three tasks: see [QUALTRICS_INTEGRATION.md](./QUALTRICS_INTEGRATION.md)
- Local testing: run `node test/static_server.js` to start a local static server, then open `http://localhost:8099/?pid=test&group=A&duration=20&difficulty=easy&diffDuration=30&diffDifficulty=easy&linkDuration=40&linkDifficulty=easy`
- Automated tests (requires Playwright + Chromium already installed locally): start the static server above, then run `node test/playwright_check.js` (covers the full three-task flow, including actually clicking the correct spot-the-difference targets and actually clicking matching tile pairs to verify the scoring logic)

## `server-version/`: full standalone version (no Qualtrics needed)

A more full-featured version with its own backend: a waiting room / instant-start flow, random group assignment, an admin interface (create studies, monitor progress, export CSV), and the complete allocation-task and survey flow are all built into this one codebase — suited to researchers who don't want to use Qualtrics and want a self-contained experiment platform instead. Built entirely on Node.js built-in modules (zero external dependencies, just run `node server.js`), and can be deployed to a platform like Render or Railway that supports long-running Node processes. See the code in that directory for details.
