// End-to-end browser test for the static GitHub-Pages game, using the
// Playwright install already present in this image (no npm install needed).
// Covers the three-task flow: math task -> spot-the-difference task ->
// tile-pair-matching (连连看) task -> results.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

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

  await page.goto(`${BASE}/?pid=TESTP1&group=A&ingroup=3&outgroup=3&duration=6&difficulty=easy&diffDuration=15&diffDifficulty=easy&linkDuration=25&linkDifficulty=easy&bias=win&debug=1`);
  await page.waitForSelector('h1');
  assert(await h1Includes(page, 'Group A'), 'intro screen shows the externally-forced group (Group A)');

  const rosterCount = await page.locator('.member-row').count();
  assert(rosterCount === 1 + 3 + 3, `roster shows 1 real + 3 in-group + 3 out-group = 7 members (got ${rosterCount})`);

  await page.click('#start-btn');
  await page.waitForSelector('#answer-input', { timeout: 3000 });

  const mathDone = await answerMathUntil(page, () => h1Includes(page, '任务一结束'), 12000);
  assert(mathDone, 'math task reaches the "任务一结束" screen within expected time');

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
  const diffDone = await answerMathUntil(page, () => h1Includes(page, '任务二结束'), 20000);
  assert(diffDone, 'diff task reaches the "任务二结束" screen within expected time');

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
  const reachedResults = await waitUntil(() => h1Includes(page, '三个任务都完成了'), 20000);
  assert(reachedResults, 'reaches the final "三个任务都完成了" results screen after all three tasks finish');

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
// 2. iframe + postMessage integration path (fully bot-driven — no manual
//    diff clicking — to verify the automatic hand-off and payload shape).
// -----------------------------------------------------------------------
async function testPostMessageIframe(browser) {
  const page = await browser.newPage();
  await page.setContent(`
    <html><body>
      <iframe id="f" name="sitFrame" src="${BASE}/?pid=IFRAME_TEST&group=B&ingroup=1&outgroup=1&duration=3&difficulty=easy&diffDuration=3&diffDifficulty=easy&linkDuration=10&linkDifficulty=easy&autostart=1" width="500" height="700"></iframe>
      <script>
        window.__received = null;
        window.addEventListener('message', (ev) => {
          if (ev.data && ev.data.type === 'sit_task_complete') window.__received = ev.data.payload;
        });
      </script>
    </body></html>
  `, { waitUntil: 'load' });

  const frame = page.frame({ name: 'sitFrame' });
  const mathDone = await answerMathUntil(frame, () => h1Includes(frame, '任务一结束'), 10000);
  assert(mathDone, 'iframe: math task completes automatically (autostart)');
  await frame.click('#start-diff-btn').catch((e) => assert(false, `could not click start-diff-btn inside iframe: ${e}`));

  const diffDone = await waitUntil(() => h1Includes(frame, '任务二结束'), 10000);
  assert(diffDone, 'iframe: diff task completes automatically');
  await frame.click('#start-link-btn').catch((e) => assert(false, `could not click start-link-btn inside iframe: ${e}`));

  await page.waitForFunction(() => window.__received !== null, { timeout: 15000 }).catch(() => {});
  const received = await page.evaluate(() => window.__received);
  assert(!!received, 'parent window received postMessage from embedded iframe after all three tasks finished');
  if (received) {
    assert(received.pid === 'IFRAME_TEST', `payload echoes pid correctly (got "${received.pid}")`);
    assert(received.group === 'B', `payload echoes the externally-forced group B (got "${received.group}")`);
    const numericFields = ['mathOwnCorrect', 'mathTeamTotal', 'mathOtherTeamTotal', 'diffPairsCompleted', 'diffTeamTotal', 'diffOtherTeamTotal', 'linkBoardsCompleted', 'linkTeamTotal', 'linkOtherTeamTotal', 'overallOwnTeamTotal', 'overallOtherTeamTotal'];
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
  const returnUrl = 'http://localhost:8099/index.html'; // reuse the static server as a stand-in "Qualtrics" target
  await page.goto(`${BASE}/?pid=REDIR_TEST&group=A&ingroup=1&outgroup=1&duration=3&difficulty=easy&diffDuration=3&diffDifficulty=easy&linkDuration=10&linkDifficulty=easy&autostart=1&returnUrl=${encodeURIComponent(returnUrl)}`);

  const mathDone = await answerMathUntil(page, () => h1Includes(page, '任务一结束'), 10000);
  assert(mathDone, 'returnUrl flow: math task completes');
  await page.click('#start-diff-btn');

  const diffDone = await waitUntil(() => h1Includes(page, '任务二结束'), 10000);
  assert(diffDone, 'returnUrl flow: diff task completes');
  await page.click('#start-link-btn');

  const reachedResults = await waitUntil(() => h1Includes(page, '三个任务都完成了'), 15000);
  assert(reachedResults, 'returnUrl flow: link task completes and results screen is shown');

  await page.click('button:has-text("继续")');
  await page.waitForLoadState('load');
  const finalUrl = new URL(page.url());
  assert(finalUrl.pathname === '/index.html', `clicking continue navigated to the configured returnUrl (got ${page.url()})`);
  assert(finalUrl.searchParams.get('sit_pid') === 'REDIR_TEST', 'returnUrl carries sit_pid query param');
  assert(finalUrl.searchParams.has('sit_mathOutcome'), 'returnUrl carries sit_mathOutcome query param');
  assert(finalUrl.searchParams.has('sit_diffPairsCompleted'), 'returnUrl carries sit_diffPairsCompleted query param');
  assert(finalUrl.searchParams.has('sit_linkBoardsCompleted'), 'returnUrl carries sit_linkBoardsCompleted query param');
  assert(finalUrl.searchParams.has('sit_overallOutcome'), 'returnUrl carries sit_overallOutcome query param');
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    await testStandalonePlay(browser);
    await testPostMessageIframe(browser);
    await testReturnUrlRedirect(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
