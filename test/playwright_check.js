// End-to-end browser test for the static GitHub-Pages game, using the
// Playwright install already present in this image (no npm install needed).
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const BASE = 'http://localhost:8099';
let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
}

async function answerUntil(page, predicate, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const problemText = await page.locator('.problem-text').textContent().catch(() => null);
    if (problemText && problemText !== '…') {
      const m = problemText.match(/(-?\d+)\s*([+\-*])\s*(-?\d+)\s*=/);
      if (m) {
        const a = Number(m[1]), op = m[2], b = Number(m[3]);
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
        const input = page.locator('#answer-input');
        if (await input.count()) {
          await input.fill(String(answer));
          await input.press('Enter');
        }
      }
    }
    if (await predicate()) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function testStandalonePlay(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${BASE}/?pid=TESTP1&group=A&ingroup=3&outgroup=3&duration=6&difficulty=easy&bias=win`);
  await page.waitForSelector('h1');
  const introText = await page.locator('h1').textContent();
  assert(introText.includes('Group A'), `intro screen shows the externally-forced group (Group A) (got "${introText}")`);

  const rosterCount = await page.locator('.member-row').count();
  assert(rosterCount === 1 + 3 + 3, `roster shows 1 real + 3 in-group + 3 out-group = 7 members (got ${rosterCount})`);

  await page.click('#start-btn');
  await page.waitForSelector('#answer-input', { timeout: 3000 });

  const finished = await answerUntil(page, async () => {
    const h1 = await page.locator('h1').first().textContent().catch(() => '');
    return h1 && h1.includes('计算任务结束');
  }, 12000);
  assert(finished, 'game reaches the results screen within expected time');

  const totalsText = await page.locator('.team-total').allTextContents();
  assert(totalsText.length === 2, 'results screen shows two team totals');
  const totalSum = totalsText.reduce((s, t) => s + Number(t.trim() || 0), 0);
  assert(totalSum > 0, `bots + player produced nonzero combined activity (totals: ${totalsText.join(', ')})`);

  assert(consoleErrors.length === 0, `no JS console errors during standalone play (got: ${JSON.stringify(consoleErrors)})`);
  await page.close();
}

async function testPostMessageIframe(browser) {
  const page = await browser.newPage();
  await page.setContent(`
    <html><body>
      <iframe id="f" src="${BASE}/?pid=IFRAME_TEST&group=B&ingroup=1&outgroup=1&duration=4&difficulty=easy&autostart=1" width="500" height="500"></iframe>
      <script>
        window.__received = null;
        window.addEventListener('message', (ev) => {
          if (ev.data && ev.data.type === 'sit_task_complete') window.__received = ev.data.payload;
        });
      </script>
    </body></html>
  `, { waitUntil: 'load' });

  await page.waitForFunction(() => window.__received !== null, { timeout: 12000 }).catch(() => {});
  const received = await page.evaluate(() => window.__received);
  assert(!!received, 'parent window received postMessage from embedded iframe after autostart game finished');
  if (received) {
    assert(received.pid === 'IFRAME_TEST', `payload echoes pid correctly (got "${received.pid}")`);
    assert(received.group === 'B', `payload echoes the externally-forced group B (got "${received.group}")`);
    assert(typeof received.ownTeamTotal === 'number' && typeof received.otherTeamTotal === 'number', 'payload includes numeric team totals');
    assert(['win', 'lose', 'tie'].includes(received.outcome), `payload includes a valid outcome field (got "${received.outcome}")`);
  }
  await page.close();
}

async function testReturnUrlRedirect(browser) {
  const page = await browser.newPage();
  const returnUrl = 'http://localhost:8099/index.html'; // reuse the static server as a stand-in "Qualtrics" target
  await page.goto(`${BASE}/?pid=REDIR_TEST&group=A&ingroup=1&outgroup=1&duration=4&difficulty=easy&autostart=1&returnUrl=${encodeURIComponent(returnUrl)}`);

  await answerUntil(page, async () => {
    const h1 = await page.locator('h1').first().textContent().catch(() => '');
    return h1 && h1.includes('计算任务结束');
  }, 10000);

  await page.click('button:has-text("继续")');
  await page.waitForLoadState('load');
  const finalUrl = new URL(page.url());
  assert(finalUrl.pathname === '/index.html', `clicking continue navigated to the configured returnUrl (got ${page.url()})`);
  assert(finalUrl.searchParams.get('sit_pid') === 'REDIR_TEST', 'returnUrl carries sit_pid query param');
  assert(finalUrl.searchParams.has('sit_ownTeamTotal'), 'returnUrl carries sit_ownTeamTotal query param');
  assert(finalUrl.searchParams.has('sit_outcome'), 'returnUrl carries sit_outcome query param');
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
