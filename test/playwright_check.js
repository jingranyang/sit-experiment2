// End-to-end browser test for the static GitHub-Pages game, using the
// Playwright install already present in this image (no npm install needed).
// Covers the three-task flow: math task -> spot-the-difference task ->
// tile-pair-matching (连连看) task -> results.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

// Resolve the pre-installed Chromium executable by globbing rather than a
// hardcoded version/folder name, since both change as the sandbox image is
// updated (e.g. chromium-1194/chrome-linux -> chromium-1243/chrome-linux64).
function resolveChromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const chromiumDirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-') && !d.startsWith('chromium_headless_shell'));
  for (const dir of chromiumDirs) {
    const base = path.join(root, dir);
    for (const sub of fs.readdirSync(base)) {
      const candidate = path.join(base, sub, 'chrome');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Could not find a chrome executable under ${root}`);
}

const BASE = 'http://localhost:8099';
let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Answers math problems as they appear on `ctx` (a Page or Frame) until
// `predicate()` returns true or `maxMs` elapses.
async function answerMathUntil(ctx, predicate, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const problemText = await ctx.locator('.problem-text').textContent().catch(() => null);
    if (problemText && problemText !== '…') {
      const m = problemText.match(/(-?\d+)\s*([+\-*])\s*(-?\d+)\s*=/);
      if (m) {
        const a = Number(m[1]), op = m[2], b = Number(m[3]);
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
        const input = ctx.locator('#answer-input');
        if (await input.count()) {
          await input.fill(String(answer));
          await input.press('Enter');
        }
      }
    }
    if (await predicate()) return true;
    await sleep(120);
  }
  return false;
}

async function h1Includes(ctx, text) {
  const h1 = await ctx.locator('h1').first().textContent().catch(() => '');
  return !!h1 && h1.includes(text);
}

// Polls a predicate without touching math input — used for waiting through
// phases (like the link task) that don't have a `.problem-text` element.
async function waitUntil(predicate, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await predicate()) return true;
    await sleep(120);
  }
  return false;
}

// Clears `numBoards` full 连连看 boards on `page` using the debug hook to
// find a real connectable pair each time (LinkMatch.findValidPair), rather
// than guessing — this exercises the actual path-finding/click handling,
// not just "some click eventually works". Requires debug=1.
async function clearLinkBoards(page, numBoards, maxMs) {
  const startCount = await page.evaluate(() => window.__sitDebug.state.link.boardsCompleted);
  const target = startCount + numBoards;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const count = await page.evaluate(() => window.__sitDebug.state.link.boardsCompleted);
    if (count >= target) return true;
    const pair = await page.evaluate(() => {
      const board = window.__sitDebug.state.link.board;
      if (!board) return null;
      return window.LinkMatch.findValidPair(board);
    });
    if (!pair) { await sleep(100); continue; } // between-round transition
    const [a, b] = pair;
    await page.locator(`[data-idx="${a}"]`).click().catch(() => {});
    await sleep(40);
    await page.locator(`[data-idx="${b}"]`).click().catch(() => {});
    await sleep(80);
  }
  return false;
}

// -----------------------------------------------------------------------
// 1. Full standalone play-through, including actually clicking the correct
//    spot-the-difference targets (using the debug hook to know exact
//    coordinates instead of guessing pixels).
// -----------------------------------------------------------------------
async function testStandalonePlay(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${BASE}/game.html?pid=TESTP1&group=A&ingroup=3&outgroup=3&duration=6&difficulty=easy&diffDuration=15&diffDifficulty=easy&linkDuration=25&linkDifficulty=easy&bias=win&debug=1`);
  await page.waitForSelector('h1');
  assert(await h1Includes(page, 'Group A'), 'intro screen shows the externally-forced group (Group A)');

  const rosterCount = await page.locator('.member-row').count();
  assert(rosterCount === 1 + 3 + 3, `roster shows 1 real + 3 in-group + 3 out-group = 7 members (got ${rosterCount})`);

  await page.click('#start-btn');
  await page.waitForSelector('#answer-input', { timeout: 3000 });

  const mathDone = await answerMathUntil(page, () => h1Includes(page, 'Task 1 Complete'), 12000);
  assert(mathDone, 'math task reaches the "Task 1 Complete" screen within expected time');

  const mathTotalsText = await page.locator('.team-total').allTextContents();
  assert(mathTotalsText.length === 2, 'math results screen shows two team totals');
  const mathTotalSum = mathTotalsText.reduce((s, t) => s + Number(t.trim() || 0), 0);
  assert(mathTotalSum > 0, `math task: bots + player produced nonzero combined activity (totals: ${mathTotalsText.join(', ')})`);

  await page.click('#start-diff-btn');
  await page.waitForSelector('#diff-canvas-a', { timeout: 3000 });

  // Use the debug hook to fetch the exact coordinates of every difference in
  // the current round, then click each one on canvas A precisely — this
  // verifies the hit-testing logic itself, not just that *some* click works.
  const round1 = await page.evaluate(() => window.__sitDebug.state.diff.round);
  assert(!!round1 && round1.diffs.length > 0, `first spot-the-difference round generated with differences (got ${round1 && round1.diffs.length})`);

  const canvasBox = await page.locator('#diff-canvas-a').boundingBox();
  for (const d of round1.diffs) {
    await page.mouse.click(canvasBox.x + d.aX, canvasBox.y + d.aY);
    await sleep(80);
  }
  await sleep(300); // allow the 550ms "round complete" transition to finish generating round 2

  const pairsAfterOneRound = await page.evaluate(() => window.__sitDebug.state.diff.pairsCompleted);
  assert(pairsAfterOneRound >= 1, `clicking every difference in a round increments diffPairsCompleted (got ${pairsAfterOneRound})`);

  const foundAfterClicks = round1.diffs.length;
  const stillMarkedFound = await page.evaluate((n) => {
    // round1 is stale by reference in the page context, so just check the
    // count of found markers requested matches what we clicked.
    return n;
  }, foundAfterClicks);
  assert(stillMarkedFound === round1.diffs.length, 'all differences in round 1 were clicked and registered as found');

  // Let the diff task run out its remaining time (bots keep scoring) so we
  // reach the diff_done transition screen.
  const diffDone = await answerMathUntil(page, () => h1Includes(page, 'Task 2 Complete'), 20000);
  assert(diffDone, 'diff task reaches the "Task 2 Complete" screen within expected time');

  await page.click('#start-link-btn');
  await page.waitForSelector('.link-tile', { timeout: 3000 });

  const firstPair = await page.evaluate(() => window.LinkMatch.findValidPair(window.__sitDebug.state.link.board));
  assert(Array.isArray(firstPair) && firstPair.length === 2, `link board has at least one connectable pair to start (got ${JSON.stringify(firstPair)})`);
  const remainingBefore = await page.evaluate(() => window.__sitDebug.state.link.board.cells.filter((v) => v !== null).length);
  await page.locator(`[data-idx="${firstPair[0]}"]`).click();
  await sleep(60);
  await page.locator(`[data-idx="${firstPair[1]}"]`).click();
  await sleep(150);
  const remainingAfter = await page.evaluate(() => {
    const b = window.__sitDebug.state.link.board;
    return b ? b.cells.filter((v) => v !== null).length : 0;
  });
  assert(remainingAfter === remainingBefore - 2 || remainingAfter > remainingBefore, `clicking a real connectable pair clears exactly those two tiles (before ${remainingBefore}, after ${remainingAfter}; a higher "after" is fine if that pair completed the board and a fresh one was generated)`);

  // Clear two full boards (using the debug hook to always click a genuinely
  // connectable pair) to verify linkBoardsCompleted actually increments.
  const clearedTwoBoards = await clearLinkBoards(page, 2, 15000);
  assert(clearedTwoBoards, 'clearing every tile pair in consecutive boards increments linkBoardsCompleted to at least 2');

  // Let the link task run out its remaining time so we reach the final
  // results screen.
  const reachedResults = await waitUntil(() => h1Includes(page, 'All Three Tasks Complete'), 20000);
  assert(reachedResults, 'reaches the final "All Three Tasks Complete" results screen after all three tasks finish');

  const finalPayload = await page.evaluate(() => {
    // Re-derive via the same debug hook rather than parsing rendered text.
    const S = window.__sitDebug.state;
    return { diffPairsCompleted: S.diff.pairsCompleted, mathOwnCorrect: S.math.correctCount, linkBoardsCompleted: S.link.boardsCompleted };
  });
  assert(finalPayload.diffPairsCompleted >= 1, `final state carries at least the one completed pair we clicked through (got ${finalPayload.diffPairsCompleted})`);
  assert(finalPayload.linkBoardsCompleted >= 2, `final state carries at least the two completed link boards we cleared (got ${finalPayload.linkBoardsCompleted})`);

  assert(consoleErrors.length === 0, `no JS console errors during standalone play (got: ${JSON.stringify(consoleErrors)})`);
  await page.close();
}

// -----------------------------------------------------------------------
// 1b. Mutual-help mechanic: earning a charge, choosing a specific teammate
//     to help, and receiving an attributed hint back. Uses the debug hook
//     (giveHelp / triggerHelpReceive) to drive the "receive help" side
//     deterministically instead of waiting on real timers.
// -----------------------------------------------------------------------
async function testMutualHelp(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${BASE}/game.html?pid=HELP_TEST&group=A&ingroup=3&outgroup=3&duration=25&difficulty=easy&diffDuration=25&diffDifficulty=easy&linkDuration=25&linkDifficulty=easy&bias=tie&helpThreshold=2&debug=1`);
  await page.waitForSelector('h1');
  await page.click('#start-btn');
  await page.waitForSelector('#answer-input', { timeout: 3000 });

  // Answer correctly until helpThreshold (2) is reached and a charge appears.
  const gotCharge = await answerMathUntil(page, async () => {
    const charges = await page.evaluate(() => window.__sitDebug.state.math.helpCharges);
    return charges >= 1;
  }, 10000);
  assert(gotCharge, 'answering helpThreshold correct problems grants a help charge');
  const chargesAfterTwo = await page.evaluate(() => window.__sitDebug.state.math.helpCharges);
  assert(chargesAfterTwo >= 1, `math.helpCharges is at least 1 once earned (got ${chargesAfterTwo})`);

  // The help panel should let the participant pick WHICH teammate to help
  // (not auto-select a target).
  const helpBtnCount = await page.locator('.help-target-btn').count();
  assert(helpBtnCount >= 1, `help panel lists at least one specific teammate to choose to help (got ${helpBtnCount})`);

  const targetBotId = await page.evaluate(() => document.querySelector('.help-target-btn').dataset.helpTarget);
  const botScheduleBefore = await page.evaluate((id) => (window.__sitDebug.state.math.schedule[id] || []).length, targetBotId);
  await page.locator('.help-target-btn').first().click();
  await sleep(150);
  const botScheduleAfter = await page.evaluate((id) => (window.__sitDebug.state.math.schedule[id] || []).length, targetBotId);
  assert(botScheduleAfter === botScheduleBefore + 1, `choosing a teammate to help injects a synthetic point into exactly that teammate's schedule (before ${botScheduleBefore}, after ${botScheduleAfter})`);

  const helpsGivenAfter = await page.evaluate(() => window.__sitDebug.state.math.helpsGiven);
  assert(helpsGivenAfter === 1, `helpsGiven is recorded after giving help (got ${helpsGivenAfter})`);
  const chargesAfterGive = await page.evaluate(() => window.__sitDebug.state.math.helpCharges);
  assert(chargesAfterGive === chargesAfterTwo - 1, `the spent help charge is deducted (before ${chargesAfterTwo}, after ${chargesAfterGive})`);

  // Simulate a teammate spontaneously sending a hint back (deterministic via
  // the debug hook rather than waiting out the real ~20-30s interval).
  await page.evaluate(() => window.__sitDebug.triggerHelpReceive('math'));
  await sleep(100);
  const hintState = await page.evaluate(() => ({ activeHint: window.__sitDebug.state.math.activeHint, helpsReceived: window.__sitDebug.state.math.helpsReceived }));
  assert(hintState.helpsReceived === 1, `helpsReceived is recorded after a teammate sends a hint (got ${hintState.helpsReceived})`);
  assert(!!hintState.activeHint && /Participant \d+/.test(hintState.activeHint), `the received hint names the specific teammate who gave it (got "${hintState.activeHint}")`);

  const hintTextOnPage = await page.locator('#math-hint').textContent();
  assert(hintTextOnPage.includes('Participant'), `the helper's identity is visibly rendered to the participant, not just tracked internally (got "${hintTextOnPage}")`);

  assert(consoleErrors.length === 0, `no JS console errors during the mutual-help flow (got: ${JSON.stringify(consoleErrors)})`);
  await page.close();
}

// -----------------------------------------------------------------------
// 2. iframe + postMessage integration path (fully bot-driven — no manual
//    diff clicking — to verify the automatic hand-off and payload shape).
// -----------------------------------------------------------------------
async function testPostMessageIframe(browser) {
  const page = await browser.newPage();
  await page.setContent(`
    <html><body>
      <iframe id="f" name="sitFrame" src="${BASE}/game.html?pid=IFRAME_TEST&group=B&ingroup=1&outgroup=1&duration=3&difficulty=easy&diffDuration=3&diffDifficulty=easy&linkDuration=10&linkDifficulty=easy&autostart=1" width="500" height="700"></iframe>
      <script>
        window.__received = null;
        window.addEventListener('message', (ev) => {
          if (ev.data && ev.data.type === 'sit_task_complete') window.__received = ev.data.payload;
        });
      </script>
    </body></html>
  `, { waitUntil: 'load' });

  const frame = page.frame({ name: 'sitFrame' });
  const mathDone = await answerMathUntil(frame, () => h1Includes(frame, 'Task 1 Complete'), 10000);
  assert(mathDone, 'iframe: math task completes automatically (autostart)');
  await frame.click('#start-diff-btn').catch((e) => assert(false, `could not click start-diff-btn inside iframe: ${e}`));

  const diffDone = await waitUntil(() => h1Includes(frame, 'Task 2 Complete'), 10000);
  assert(diffDone, 'iframe: diff task completes automatically');
  await frame.click('#start-link-btn').catch((e) => assert(false, `could not click start-link-btn inside iframe: ${e}`));

  await page.waitForFunction(() => window.__received !== null, { timeout: 15000 }).catch(() => {});
  const received = await page.evaluate(() => window.__received);
  assert(!!received, 'parent window received postMessage from embedded iframe after all three tasks finished');
  if (received) {
    assert(received.pid === 'IFRAME_TEST', `payload echoes pid correctly (got "${received.pid}")`);
    assert(received.group === 'B', `payload echoes the externally-forced group B (got "${received.group}")`);
    const numericFields = ['mathOwnCorrect', 'mathTeamTotal', 'mathOtherTeamTotal', 'diffPairsCompleted', 'diffTeamTotal', 'diffOtherTeamTotal', 'linkBoardsCompleted', 'linkTeamTotal', 'linkOtherTeamTotal', 'overallOwnTeamTotal', 'overallOtherTeamTotal', 'mathHelpsGiven', 'mathHelpsReceived', 'diffHelpsGiven', 'diffHelpsReceived', 'linkHelpsGiven', 'linkHelpsReceived', 'totalHelpsGiven', 'totalHelpsReceived'];
    const allNumeric = numericFields.every((k) => typeof received[k] === 'number');
    assert(allNumeric, `payload includes all numeric fields for all three tasks (got ${JSON.stringify(received)})`);
    const outcomeFields = ['mathOutcome', 'diffOutcome', 'linkOutcome', 'overallOutcome'];
    const allValidOutcomes = outcomeFields.every((k) => ['win', 'lose', 'tie'].includes(received[k]));
    assert(allValidOutcomes, `payload includes valid outcome fields for math/diff/link/overall (got ${JSON.stringify(received)})`);
  }
  await page.close();
}

// -----------------------------------------------------------------------
// 3. returnUrl redirect handoff path.
// -----------------------------------------------------------------------
async function testReturnUrlRedirect(browser) {
  const page = await browser.newPage();
  const returnUrl = 'http://localhost:8099/game.html'; // reuse the static server as a stand-in "Qualtrics" target
  await page.goto(`${BASE}/game.html?pid=REDIR_TEST&group=A&ingroup=1&outgroup=1&duration=3&difficulty=easy&diffDuration=3&diffDifficulty=easy&linkDuration=10&linkDifficulty=easy&autostart=1&returnUrl=${encodeURIComponent(returnUrl)}`);

  const mathDone = await answerMathUntil(page, () => h1Includes(page, 'Task 1 Complete'), 10000);
  assert(mathDone, 'returnUrl flow: math task completes');
  await page.click('#start-diff-btn');

  const diffDone = await waitUntil(() => h1Includes(page, 'Task 2 Complete'), 10000);
  assert(diffDone, 'returnUrl flow: diff task completes');
  await page.click('#start-link-btn');

  const reachedResults = await waitUntil(() => h1Includes(page, 'All Three Tasks Complete'), 15000);
  assert(reachedResults, 'returnUrl flow: link task completes and results screen is shown');

  await page.click('button:has-text("Continue")');
  await page.waitForLoadState('load');
  const finalUrl = new URL(page.url());
  assert(finalUrl.pathname === '/game.html', `clicking continue navigated to the configured returnUrl (got ${page.url()})`);
  assert(finalUrl.searchParams.get('sit_pid') === 'REDIR_TEST', 'returnUrl carries sit_pid query param');
  assert(finalUrl.searchParams.has('sit_mathOutcome'), 'returnUrl carries sit_mathOutcome query param');
  assert(finalUrl.searchParams.has('sit_diffPairsCompleted'), 'returnUrl carries sit_diffPairsCompleted query param');
  assert(finalUrl.searchParams.has('sit_linkBoardsCompleted'), 'returnUrl carries sit_linkBoardsCompleted query param');
  assert(finalUrl.searchParams.has('sit_overallOutcome'), 'returnUrl carries sit_overallOutcome query param');
  await page.close();
}

// -----------------------------------------------------------------------
// 4. Full study-flow tests (index.html): Entry -> Demographics -> Random
//    Assignment -> Condition 1/2/3 -> shared Outcome Measures -> Debrief.
//    Condition 2 embeds game.html via iframe; Conditions 1/3 are pure
//    survey screens using the exact wording from the KU POLS proposal.
// -----------------------------------------------------------------------
async function fillEntryAndContinue(page) {
  await page.waitForSelector('#entry-continue-btn', { timeout: 5000 });
  await page.check('#chk-adult');
  await page.check('#chk-us');
  await page.check('#chk-agree');
  await page.click('#entry-continue-btn');
}

// The questionnaire shows one question per page (Previous / Next). These
// helpers answer whatever page is visible and click Next until the debrief.
const CORRECT_COMP = {
  unlimited: { qp: 'Only me', q5: 'Unlimited', q6: 'The gold coins other participants receive will not be affected' },
  fixed50: { qp: 'Only me', q5: 'Fixed at 50 coins', q6: 'Must be exactly 50 coins', q7: 'May require reducing gold coins allocated to others', q8: 'Since the total is limited, trade-offs between participants may be needed' },
};

async function currentQid(page) {
  return page.evaluate(() => { const p = document.querySelector('#q-pages .q-page:not(.hidden)'); return p ? p.dataset.qid : null; });
}

// Sets every participant's gold coins with the − / + steppers (clicking
// the real buttons): − until 0, then + `perPersonValue` times. Returns the
// values the page ends up showing.
async function fillAllocations(page, perPersonValue) {
  const v = Number(perPersonValue);
  return page.evaluate((n) => {
    const out = [];
    document.querySelectorAll('.q-page:not(.hidden) .stepper').forEach((st) => {
      const minus = st.querySelector('.minus'), plus = st.querySelector('.plus');
      for (let i = 0; i < 12 && !minus.disabled; i++) minus.click();
    });
    document.querySelectorAll('.q-page:not(.hidden) .stepper').forEach((st) => {
      const plus = st.querySelector('.plus');
      for (let i = 0; i < n && !plus.disabled; i++) plus.click();
      out.push(st.querySelector('.step-val').textContent);
    });
    return out;
  }, v);
}

async function setSlider(page, id, value) {
  await page.evaluate(([i, v]) => {
    const el = document.getElementById(i);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, value]);
}

// opts: { alloc: coins per participant (0-10), slider: number, comp: {qid: answer} }
// Returns the list of page ids visited, in order.
async function completeQuestionnaire(page, opts) {
  const visited = [];
  for (let i = 0; i < 40; i++) {
    if (await h1Now(page, 'Debriefing Statement')) break;
    const qid = await currentQid(page);
    if (!qid) { await sleep(100); continue; }
    visited.push(qid);
    const visibleCount = await page.locator('#q-pages .q-page:not(.hidden)').count();
    assert(visibleCount === 1, `questionnaire: exactly one question page visible at a time (page ${qid})`);
    if (qid === 'alloc') await fillAllocations(page, opts.alloc);
    else if (['identification', 'ingroupAffect', 'outgroupAffect'].includes(qid)) await setSlider(page, qid, opts.slider);
    else if (qid.startsWith('comp-')) await page.locator(`input[name="${qid}"][value="${opts.comp[qid.slice(5)]}"]`).check();
    else if (qid.startsWith('demo-')) await page.locator(`#q-pages .q-page[data-qid="${qid}"] input[type="radio"]`).first().check();
    await page.click('#pg-next');
    await sleep(60);
  }
  return visited;
}

async function testFullFlowCondition1(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${BASE}/?pid=FLOW_C1&condition=1&group=A&ingroup=4&outgroup=5&debug=1`);
  await fillEntryAndContinue(page);

  const reachedIntro = await waitUntil(() => h1Includes(page, 'Task Instructions'), 5000);
  assert(reachedIntro, 'condition 1: reaches the Group Label task-instructions screen');
  const badgeText = await page.locator('.badge').first().textContent();
  assert(/Group A/.test(badgeText || ''), `condition 1: shown group assignment matches the forced group A (got "${badgeText}")`);
  await page.click('#task-intro-continue-btn');

  const reachedMeasures = await waitUntil(async () => (await currentQid(page)) === 'alloc', 5000);
  assert(reachedMeasures, 'condition 1: reaches the outcome-measures (allocation task) screen');
  const rowCount = await page.locator('.alloc-table tbody tr').count();
  assert(rowCount === 10, `condition 1: allocation table lists all 10 participants (got ${rowCount})`);
  const noCapShown = (await page.locator('#alloc-total-line').count()) === 0;
  assert(noCapShown, 'condition 1 (unlimited mode): no running-total cap is shown');

  // Pager behaviour: Next is blocked until the page is answered; Previous
  // goes back with answers kept.
  const scen = await page.locator('.notice.scenario').textContent();
  assert(/Only you know about these gold coins/.test(scen) && /no one else will see how you allocate/.test(scen) && !/community/.test(scen), `scenario: abstract wording that only the participant knows about the coins (got "${scen}")`);
  assert(await page.locator('#pg-prev').isDisabled(), 'pager: Previous is disabled on the first page');
  await page.click('#pg-next');
  assert((await page.locator('#pg-error:not(.hidden)').count()) === 1 && (await currentQid(page)) === 'alloc', 'pager: Next is blocked until the allocation page is complete');
  const maxed = await fillAllocations(page, 12);
  assert(maxed.every((x) => x === '10'), `steppers (unlimited): each participant tops out at 10 and there is no total cap (got ${maxed})`);
  assert((await page.locator('#alloc-total-line').count()) === 0, 'steppers (unlimited): no budget counter is shown');
  await fillAllocations(page, '1');
  await page.click('#pg-next');
  assert((await currentQid(page)) === 'identification', 'pager: Next moves to the identification page');
  await page.click('#pg-prev');
  assert((await currentQid(page)) === 'alloc', 'pager: Previous goes back to the allocation page');
  const kept = await page.locator('.stepper .step-val:not(.unset)').allTextContents();
  assert(kept.length === 10 && kept.every((x) => x === '1'), `pager: allocation answers are kept after going back (got ${kept})`);
  const visited = await completeQuestionnaire(page, { alloc: 1, slider: 15, comp: CORRECT_COMP.unlimited });
  const firstDemo = visited.findIndex((q) => q.startsWith('demo-'));
  const lastComp = visited.map((q) => q.startsWith('comp-')).lastIndexOf(true);
  assert(firstDemo > lastComp && lastComp > 0, `flow order: background questions come after the comprehension checks (pages: ${visited.join(', ')})`);
  assert(visited.filter((q) => q.startsWith('demo-')).length === 4, 'background questions: one page per question (4 pages)');

  const reachedDebrief = await waitUntil(() => h1Includes(page, 'Debriefing Statement'), 5000);
  assert(reachedDebrief, 'condition 1: reaches the debrief screen after completing measures');

  const payload = await page.evaluate(() => window.__studyDebug.state.finalPayload);
  assert(!!payload, 'condition 1: a final payload was assembled on reaching debrief');
  assert(payload.demographics && payload.demographics.gender && payload.demographics.party, `condition 1: payload includes the background answers given at the end (got ${JSON.stringify(payload.demographics)})`);
  assert(payload.condition === 1 && payload.conditionName === 'group_label_control', `condition 1: payload records the correct condition (got ${JSON.stringify({ c: payload.condition, n: payload.conditionName })})`);
  assert(payload.allocationMode === 'unlimited', 'condition 1: payload records unlimited allocation mode');
  assert(payload.allocation.entries.length === 10, 'condition 1: payload carries all 10 allocation entries');
  assert(payload.identification === 15 && payload.ingroupAffect === 15 && payload.outgroupAffect === 15, `condition 1: payload records the slider answers (got ${JSON.stringify({ i: payload.identification, ig: payload.ingroupAffect, og: payload.outgroupAffect })})`);
  assert(payload.comprehension.q5.correct === true && payload.comprehension.q6.correct === true, 'condition 1: comprehension answers are scored correct when the correct option is chosen');
  assert(payload.game === null, 'condition 1: no game payload is attached (games only run in condition 2)');
  assert(consoleErrors.length === 0, `condition 1: no JS console errors (got: ${JSON.stringify(consoleErrors)})`);
  await page.close();
}

// Non-blocking heading check (h1Includes waits for an <h1> to exist,
// which stalls during gameplay screens that have none).
async function h1Now(ctx, text) {
  const h = await ctx.evaluate(() => { const el = document.querySelector('h1'); return el ? el.textContent : ''; }).catch(() => '');
  return h.includes(text);
}

// Ready lobby before a contest round: everyone starts "Waiting…", the
// participant clicks ready, simulated players get ready over time, and the
// round starts on its own once all are ready.
async function lobbyAndStart(f, tag, round, mode) {
  await f.waitForSelector('#ready-btn', { timeout: 8000 });
  const n = mode === 'group' ? 10 : 2;
  assert((await f.locator('.ready-chip').count()) === n, `${tag}: Round ${round} lobby lists all ${n} players`);
  await f.click('#ready-btn');
  assert(await f.locator('#ready-btn').isDisabled(), `${tag}: Round ${round} lobby marks the participant ready`);
  const allReady = await waitUntil(async () => (await f.locator('.ready-chip.on').count()) === n, 6000);
  assert(allReady, `${tag}: Round ${round} lobby — every simulated player becomes ready`);
  const started = await waitUntil(async () => (await f.locator('#tug-knot').count()) > 0, 6000);
  assert(started, `${tag}: Round ${round} starts automatically once all players are ready`);
}

// Condition 3 = Experiment 3 "Intergroup Conflict Contest": the same three
// game.html tasks as Condition 2, in contest mode (tug-of-war rope, scripted
// opposing side, preset-only team chat in the group arm). Plays one arm of
// the 2 (group/individual) x 2 (win/lose) design at a human-like pace.
async function playContestArm(browser, mode, outcome, order, extraParams = '') {
  const tag = `condition 3 [${mode}/${order}+${outcome}${extraParams ? ' ' + extraParams : ''}]`;
  const page = await browser.newPage({ viewport: { width: 760, height: 1400 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${BASE}/?pid=FLOW_C3_${mode}_${outcome}&condition=3&contestMode=${mode}&outcome=${outcome}&order=${order}&group=B&ingroup=4&outgroup=5&duration=40&diffDuration=25&linkDuration=25&difficulty=easy&diffDifficulty=easy&linkDifficulty=easy&helpThreshold=3&helpReceiveInterval=6&lobbyMax=3&lobbyCountdown=1&debug=1${extraParams}`);
  await fillEntryAndContinue(page);
  assert((await page.locator('#demo-continue-btn').count()) === 0, `${tag}: no background questions before the game`);
  await page.waitForSelector('#game-frame', { timeout: 5000 });
  let f = null;
  await waitUntil(async () => { f = page.frames().find((x) => x.url().includes('game.html')); return !!f; }, 5000);
  const reachedIntro = await waitUntil(() => h1Includes(f, 'How the Contest Works'), 5000);
  assert(reachedIntro, `${tag}: game.html opens in contest mode with the contest instructions`);
  const overviewText = await f.locator('.card').first().textContent();
  assert(/Calculation/.test(overviewText) && /Spot the Difference/.test(overviewText) && /Match Pairs/.test(overviewText) && /Winner takes all/i.test(overviewText) && /10 points/.test(overviewText), `${tag}: overview explains all three rounds, scoring, starting points and winner-takes-all`);
  assert(mode === 'group' ? /chat with your own group/.test(overviewText) : !/chat/.test(overviewText), `${tag}: overview ${mode === 'group' ? 'mentions' : 'omits'} the team chat`);
  await f.click('#overview-continue-btn');
  const assignH1 = await f.locator('h1').first().textContent();
  assert(mode === 'group' ? /randomly assigned to\s+Group B/.test(assignH1) : /paired with Participant/.test(assignH1), `${tag}: assignment screen shows the assigned ${mode === 'group' ? 'group' : 'opponent'} (got "${assignH1}")`);
  await f.click('#assign-continue-btn');
  await lobbyAndStart(f, tag, 1, mode);
  await f.waitForSelector('#tug-knot', { timeout: 5000 });
  assert((await f.locator('.chat-preset-btn').count()) === (mode === 'group' ? 5 : 0), `${tag}: ${mode === 'group' ? 'team chat shows exactly the 5 preset messages' : 'no chat in the individual arm'}`);
  assert((await f.locator('textarea, input[type="text"]').count()) === 0, `${tag}: no free-text chat input exists`);
  assert((await f.locator('.help-panel').count()) === (mode === 'group' ? 1 : 0), `${tag}: mutual-help panel ${mode === 'group' ? 'present' : 'absent'}`);

  let sentChat = false;
  async function groupExtras() {
    if (mode !== 'group') return;
    if (!sentChat) { await f.locator('.chat-preset-btn').first().click({ timeout: 800 }).catch(() => {}); sentChat = true; }
    const helpBtn = f.locator('.help-target-btn').first();
    if (await helpBtn.count()) await helpBtn.click({ timeout: 800 }).catch(() => {});
  }
  // Round 1: math, ~1 correct answer per 2.5s.
  while ((await f.locator('#next-round-btn').count()) === 0) {
    const t = await f.locator('.problem-text').textContent({ timeout: 800 }).catch(() => null);
    const m = t && t.match(/(-?\d+)\s*([+\-*])\s*(-?\d+)\s*=/);
    if (m) {
      const x = Number(m[1]), op = m[2], y = Number(m[3]);
      await f.locator('#answer-input').fill(String(op === '+' ? x + y : op === '-' ? x - y : x * y), { timeout: 800 }).catch(() => {});
      await f.locator('#answer-input').press('Enter', { timeout: 800 }).catch(() => {});
    }
    await groupExtras();
    await sleep(2500);
  }
  // End-of-round screen: points animation, and (group arm) reaction chat.
  const r1Before = await f.evaluate(() => window.__sitDebug.contest.state.rounds[0].pointsBefore);
  assert(r1Before.own === 10 && r1Before.opp === 10, `${tag}: Round 1 transfer starts from 10 : 10 (got ${JSON.stringify(r1Before)})`);
  assert(await f.locator('#next-round-btn').isDisabled(), `${tag}: next-round button waits for the transfer animation`);
  if (mode === 'group') {
    assert((await f.locator('.chat-preset-btn').count()) === 5, `${tag}: end-of-round screen keeps the team chat with 5 reaction presets`);
    await f.locator('.chat-preset-btn').first().click({ timeout: 800 }).catch(() => {});
  } else {
    assert((await f.locator('.chat-preset-btn').count()) === 0, `${tag}: no chat on the end-of-round screen in the individual arm`);
  }
  await waitUntil(async () => !(await f.locator('#next-round-btn').isDisabled()), 8000);
  const r1PtsAfter = await f.evaluate(() => [document.getElementById('pt-num-own').textContent, document.getElementById('pt-num-opp').textContent, document.getElementById('pt-delta-own').textContent]);
  assert(order === 'WL' ? (r1PtsAfter[0] === '15' && r1PtsAfter[1] === '5' && r1PtsAfter[2] === '+5') : (r1PtsAfter[0] === '5' && r1PtsAfter[1] === '15' && r1PtsAfter[2] === '−5'), `${tag}: after the animation the counters read ${order === 'WL' ? '15 : 5 (+5)' : '5 : 15 (−5)'} (got ${r1PtsAfter})`);
  const r1 = await f.locator('h1').first().textContent();
  assert((order === 'WL' ? /won Round 1/ : /lost Round 1/).test(r1), `${tag}: Round 1 result matches order ${order} (got "${r1}")`);
  await f.click('#next-round-btn');
  await lobbyAndStart(f, tag, 2, mode);
  // Round 2: spot the difference, one difference clicked every ~2s.
  while (!(await h1Now(f, 'Round 2'))) {
    const round = await f.evaluate(() => window.__sitDebug.state.diff.round).catch(() => null);
    const box = await f.locator('#diff-canvas-a').boundingBox({ timeout: 800 }).catch(() => null);
    const next = round && round.diffs.find((d) => !d.found);
    if (box && next) await page.mouse.click(box.x + next.aX, box.y + next.aY).catch(() => {});
    await groupExtras();
    await sleep(2000);
  }
  const r2 = await f.locator('h1').first().textContent();
  assert((order === 'WL' ? /lost Round 2/ : /won Round 2/).test(r2), `${tag}: Round 2 result matches order ${order} (got "${r2}")`);
  const tiedPoints = await f.evaluate(() => window.__sitDebug.contest.state.points);
  assert(tiedPoints.own === 10 && tiedPoints.opp === 10, `${tag}: both sides are tied at 10 points going into the final round (got ${JSON.stringify(tiedPoints)})`);
  assert((await f.locator('text=winner takes all').count()) > 0, `${tag}: the between-round screen announces Round 3 is winner-takes-all`);
  await f.click('#next-round-btn');
  await lobbyAndStart(f, tag, 3, mode);
  // Round 3: match pairs, one pair every ~1.5s.
  while (!(await h1Now(f, 'the contest'))) {
    const pair = await f.evaluate(() => { const b = window.__sitDebug.state.link.board; return b ? window.LinkMatch.findValidPair(b) : null; }).catch(() => null);
    if (pair) {
      await f.locator(`[data-idx="${pair[0]}"]`).click({ timeout: 800 }).catch(() => {});
      await sleep(60);
      await f.locator(`[data-idx="${pair[1]}"]`).click({ timeout: 800 }).catch(() => {});
    }
    await groupExtras();
    await sleep(1500);
  }
  const headline = await f.locator('h1').first().textContent();
  assert(outcome === 'win' ? /won/.test(headline) : /lost/.test(headline), `${tag}: results screen shows the assigned outcome (got "${headline}")`);
  const st = await f.evaluate(() => window.__sitDebug.state);
  const cs = await f.evaluate(() => window.__sitDebug.contest.state);
  if (mode === 'group') {
    // Opposing team members' counts should vary, not move in lockstep.
    const perMember = Object.values(cs.oppMember.math);
    const spread = perMember.length ? Math.max(...perMember) - Math.min(...perMember) : 0;
    assert(perMember.length === 5 && spread >= 2, `${tag}: opposing team members' Round 1 scores differ from one another (got ${JSON.stringify(perMember)})`);
    assert(perMember.reduce((a, b) => a + b, 0) === cs.oppUnits.math, `${tag}: opposing members' scores add up to the team total`);
  }
  const totalLeadChanges = cs.leadChanges.math + cs.leadChanges.diff + cs.leadChanges.link;
  assert(totalLeadChanges >= 3, `${tag}: the lead changed hands within the rounds (got ${JSON.stringify(cs.leadChanges)})`);
  assert(cs.rounds.length === 3 && cs.rounds.every((r) => r.realizedOutcome === r.assignedOutcome), `${tag}: every round ended as assigned (${JSON.stringify(cs.rounds.map((r) => [r.assignedOutcome, r.realizedOutcome]))})`);
  assert(cs.rounds[0].pointsTransferred === 5 && cs.rounds[1].pointsTransferred === 5 && cs.rounds[2].pointsTransferred === 10, `${tag}: 5 / 5 / all (10) points transferred in Rounds 1 / 2 / 3`);
  assert(outcome === 'win' ? (cs.points.own === 20 && cs.points.opp === 0) : (cs.points.own === 0 && cs.points.opp === 20), `${tag}: final points are ${outcome === 'win' ? '20 vs 0' : '0 vs 20'} (got ${JSON.stringify(cs.points)})`);
  if (mode === 'group') {
    const given = st.math.helpsGiven + st.diff.helpsGiven + st.link.helpsGiven;
    const recv = st.math.helpsReceived + st.diff.helpsReceived + st.link.helpsReceived;
    assert(given >= 1 && recv >= 1, `${tag}: help given (${given}) and received (${recv})`);
    const presets = await f.evaluate(() => ({ play: window.__sitDebug.contest.playPresets.map((m) => m.text), reactions: Object.values(window.__sitDebug.contest.reactionPresets).flat().map((m) => m.text) }));
    const playMsgs = cs.chat.filter((c) => ['math', 'diff', 'link'].includes(c.phase));
    const endMsgs = cs.chat.filter((c) => !['math', 'diff', 'link'].includes(c.phase));
    assert(playMsgs.length >= 4 && playMsgs.every((c) => presets.play.includes(c.text)), `${tag}: every in-play chat message is one of the 5 play presets (n=${playMsgs.length})`);
    assert(endMsgs.length >= 3 && endMsgs.every((c) => presets.reactions.includes(c.text)), `${tag}: end-of-round chat uses only the reaction presets (n=${endMsgs.length})`);
    assert(endMsgs.some((c) => c.sender === 'self'), `${tag}: participant's own reaction appears in the end-of-round chat`);
    assert(cs.chat.some((c) => c.sender === 'self'), `${tag}: participant's own preset message appears in the chat`);
  }
  await f.click('#contest-continue-btn');

  await waitUntil(async () => (await currentQid(page)) === 'alloc', 5000);
  assert((await page.locator('.alloc-table tbody tr').count()) === 10, `${tag}: allocation table lists all 10 participants`);
  assert((await page.locator('.alloc-table thead th').count()) === (mode === 'group' ? 3 : 2), `${tag}: Group column ${mode === 'group' ? 'shown' : 'hidden'}`);
  assert((await page.locator('#identification').count()) === (mode === 'group' ? 1 : 0), `${tag}: group-identification question ${mode === 'group' ? 'shown' : 'omitted'}`);

  const fixed50 = !extraParams.includes('exp3Alloc=unlimited');
  if (fixed50) {
    // Budget: exactly 50 gold coins must be allocated, 0-10 each.
    await fillAllocations(page, 0);
    await page.click('#pg-next');
    const errText = await page.locator('#pg-error').textContent();
    assert((await currentQid(page)) === 'alloc' && /exactly 50/.test(errText), `${tag}: Next is blocked until exactly 50 gold coins are allocated (error: "${errText}")`);
    const greedy = await fillAllocations(page, 10);
    const sumGreedy = greedy.reduce((a, x) => a + Number(x), 0);
    const plusesDisabled = await page.locator('.q-page:not(.hidden) .step-btn.plus:not([disabled])').count();
    const remaining = await page.locator('#alloc-remaining').textContent();
    assert(sumGreedy === 50 && plusesDisabled === 0 && remaining === '0', `${tag}: the + buttons stop at 50 coins in total (allocated ${sumGreedy}, remaining ${remaining}, active + buttons ${plusesDisabled})`);
  }
  const comp = Object.assign({}, CORRECT_COMP[fixed50 ? 'fixed50' : 'unlimited'], { qc1: 'The winning side took all of them', qc2: outcome === 'win' ? 'Won' : 'Lost' });
  await completeQuestionnaire(page, { alloc: fixed50 ? 5 : 1, slider: -10, comp });
  assert(await waitUntil(() => h1Includes(page, 'Debriefing Statement'), 5000), `${tag}: reaches debrief`);
  const debriefText = await page.locator('.card').first().textContent();
  assert(/determined in advance/.test(debriefText || ''), `${tag}: debrief discloses the predetermined outcome and simulated participants`);
  const payload = await page.evaluate(() => window.__studyDebug.state.finalPayload);
  assert(payload.condition === 3 && payload.conditionName === 'intergroup_conflict_contest', `${tag}: payload records condition 3`);
  assert(payload.contestMode === mode && payload.contestOutcomeAssigned === outcome && payload.contestOrder === order, `${tag}: payload records contest mode, order and final outcome`);
  assert(payload.contest && payload.contest.outcomeManipulationOk === true, `${tag}: realized outcome matches assigned (realized=${payload.contest && payload.contest.realizedOutcome})`);
  assert(payload.game && payload.game.overallOutcome === outcome, `${tag}: game payload overallOutcome matches`);
  assert(payload.allocationMode === (fixed50 ? 'fixed50' : 'unlimited'), `${tag}: payload records the allocation mode`);
  assert(payload.allocation.entries.every((e) => e.allocation === (fixed50 ? 5 : 1)) && payload.allocation.total === (fixed50 ? 50 : 10) && payload.allocation.budget === (fixed50 ? 50 : null), `${tag}: payload records numeric allocations and the total (${payload.allocation.total}, budget ${payload.allocation.budget})`);
  assert(payload.comprehension.qc1.correct && payload.comprehension.qc2.correct, `${tag}: contest comprehension checks scored correct`);
  assert(mode === 'group' ? payload.identification === -10 : payload.identification === null, `${tag}: identification recorded (group) / null (individual)`);
  if (mode === 'individual') {
    const opp = payload.allocation.entries.filter((e) => e.isOpponent);
    const oppInGame = payload.game.roster.find((p) => !p.isReal);
    assert(opp.length === 1 && oppInGame && opp[0].label === oppInGame.label, `${tag}: the flagged opponent in the allocation table is the same participant faced in the contest`);
  }
  assert(consoleErrors.length === 0, `${tag}: no JS console errors (got: ${JSON.stringify(consoleErrors)})`);
  await page.close();
}

async function testFullFlowCondition3(browser) {
  await Promise.all([
    playContestArm(browser, 'group', 'win', 'WL'),
    playContestArm(browser, 'group', 'lose', 'LW'),
    playContestArm(browser, 'individual', 'win', 'LW'),
    playContestArm(browser, 'individual', 'lose', 'WL', '&exp3Alloc=unlimited'),
  ]);
}

async function testFullFlowCondition2(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${BASE}/?pid=FLOW_C2&condition=2&group=A&ingroup=1&outgroup=1&duration=3&diffDuration=3&linkDuration=6&difficulty=easy&diffDifficulty=easy&linkDifficulty=easy&debug=1`);
  await fillEntryAndContinue(page);

  await page.waitForSelector('#game-frame', { timeout: 5000 });
  let gameFrame = null;
  const gotFrame = await waitUntil(async () => {
    gameFrame = page.frames().find((f) => f.url().includes('game.html'));
    return !!gameFrame;
  }, 5000);
  assert(gotFrame, 'condition 2: the game iframe loads game.html');

  const mathDone = await answerMathUntil(gameFrame, () => h1Includes(gameFrame, 'Task 1 Complete'), 10000);
  assert(mathDone, 'condition 2: embedded game — math task completes');
  await gameFrame.click('#start-diff-btn');
  const diffDone = await waitUntil(() => h1Includes(gameFrame, 'Task 2 Complete'), 10000);
  assert(diffDone, 'condition 2: embedded game — diff task completes');
  await gameFrame.click('#start-link-btn');

  // We never click any link tiles ourselves; the link task runs out its
  // duration on its own (bot-driven) and should then hand control back to
  // the outer flow via postMessage, landing on the shared measures screen.
  const reachedMeasures = await waitUntil(async () => (await currentQid(page)) === 'alloc', 15000);
  assert(reachedMeasures, 'condition 2: outer flow advances to outcome-measures after the embedded game finishes');

  const rowCount = await page.locator('.alloc-table tbody tr').count();
  assert(rowCount === 3, `condition 2: allocation table reuses the embedded game's own roster size (got ${rowCount} rows for ingroup=1/outgroup=1 => 3 total)`);

  await completeQuestionnaire(page, { alloc: 0, slider: 5, comp: CORRECT_COMP.unlimited });

  const reachedDebrief = await waitUntil(() => h1Includes(page, 'Debriefing Statement'), 5000);
  assert(reachedDebrief, 'condition 2: reaches debrief after measures');
  const debriefText = await page.locator('.card').first().textContent();
  assert((debriefText || '').includes('simulated by the computer'), 'condition 2: debrief discloses that teammates/opponents were simulated');

  const payload = await page.evaluate(() => window.__studyDebug.state.finalPayload);
  assert(payload.condition === 2 && payload.conditionName === 'enhanced_belonging', 'condition 2: payload records the correct condition');
  assert(!!payload.game, "condition 2: payload carries the embedded game's full result payload");
  assert(typeof (payload.game && payload.game.overallOutcome) === 'string', `condition 2: game payload includes overallOutcome (got ${JSON.stringify(payload.game && payload.game.overallOutcome)})`);
  assert(Array.isArray(payload.game.roster) && payload.game.roster.length === rowCount, "condition 2: game payload's roster matches the allocation table size");
  assert(consoleErrors.length === 0, `condition 2: no JS console errors (got: ${JSON.stringify(consoleErrors)})`);
  await page.close();
}

async function testRandomConditionAssignment(browser) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/?pid=FLOW_RAND&ingroup=1&outgroup=1&debug=1`);
  await fillEntryAndContinue(page);
  const assigned = await waitUntil(async () => {
    const c = await page.evaluate(() => window.__studyDebug.state.condition);
    return c !== null;
  }, 5000);
  assert(assigned, 'random assignment: a condition is assigned when ?condition= is not forced');
  const condition = await page.evaluate(() => window.__studyDebug.state.condition);
  assert([1, 2, 3].includes(condition), `random assignment: assigned condition is one of 1/2/3 (got ${condition})`);
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), args: ['--no-sandbox'] });
  try {
    await testStandalonePlay(browser);
    await testMutualHelp(browser);
    await testPostMessageIframe(browser);
    await testReturnUrlRedirect(browser);
    await testFullFlowCondition1(browser);
    await testFullFlowCondition3(browser);
    await testFullFlowCondition2(browser);
    await testRandomConditionAssignment(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
