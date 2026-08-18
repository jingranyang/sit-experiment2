// Standalone integration test: simulates N independent real participants each
// running through the entire flow on their own (no waiting for each other —
// "teammates" and "opponents" are computer-simulated) against a running server
// instance. Uses only global fetch — no test framework dependency.
//
// Usage: node test/simulate.js <baseHttpUrl> <studyId>

const baseUrl = process.argv[2] || 'http://localhost:3131';
const studyId = process.argv[3];
if (!studyId) {
  console.error('Usage: node test/simulate.js <baseHttpUrl> <studyId>');
  process.exit(1);
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${data.message || 'error'}`);
  return data;
}

async function runParticipant(tag, { answerCorrectly = true } = {}) {
  const start = await api('/api/runs/start', { method: 'POST', body: JSON.stringify({ studyId }) });
  const { runToken, roster, label, groupLabel, mathDurationSec } = start;

  await api(`/api/runs/${runToken}/game/start`, { method: 'POST' });

  const gameEndAt = Date.now() + mathDurationSec * 1000;
  let myCorrect = 0;
  while (Date.now() < gameEndAt) {
    const p = await api(`/api/runs/${runToken}/problem`);
    if (p.finished) break;
    const m = p.text.match(/^(-?\d+)\s*([+\-*])\s*(-?\d+)$/);
    let answer = 0;
    if (m) {
      const a = Number(m[1]), op = m[2], b = Number(m[3]);
      answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
      if (!answerCorrectly) answer += 999; // force wrong
    }
    const res = await api(`/api/runs/${runToken}/answer`, { method: 'POST', body: JSON.stringify({ problemId: p.problemId, answer }) });
    if (res.finished) break;
    if (res.correct) myCorrect++;
    await new Promise((r) => setTimeout(r, 40));
  }

  // Poll scoreboard until server marks finished.
  let scoreboard = null;
  for (let i = 0; i < 50; i++) {
    scoreboard = await api(`/api/runs/${runToken}/scoreboard`);
    if (scoreboard.finished) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  async function allocateAndSurvey(phase) {
    const allocations = roster.map((p, idx) => ({ targetId: p.id, tokens: phase === 'scarce' ? (idx < 10 ? '1' : '0') : '2' }));
    await api(`/api/runs/${runToken}/allocation`, { method: 'POST', body: JSON.stringify({ phase, allocations }) });
    await api(`/api/runs/${runToken}/survey`, {
      method: 'POST',
      body: JSON.stringify({ phase, identification: 20, ingroupFeeling: 25, outgroupFeeling: -5 }),
    });
  }
  await allocateAndSurvey('nonscarce');
  await allocateAndSurvey('scarce');
  await api(`/api/runs/${runToken}/phase`, { method: 'POST', body: JSON.stringify({ phase: 'done' }) });

  return { tag, runToken, label, groupLabel, roster, myCorrect, scoreboard };
}

async function main() {
  console.log(`Running 3 independent simulated participants against study ${studyId} (each starts on their own, no waiting)...`);
  const results = await Promise.all([
    runParticipant('P1'),
    runParticipant('P2', { answerCorrectly: false }), // this one answers everything wrong, sanity-checks 0 correct
    runParticipant('P3'),
  ]);

  const ids = new Set(results.map((r) => r.runToken));
  assert(ids.size === 3, 'each participant got an independent run token (no collision)');

  for (const r of results) {
    assert(r.roster.length >= 2, `${r.tag} roster includes simulated teammates/opponents (size=${r.roster.length})`);
    const selfEntries = r.roster.filter((p) => p.id === 'self');
    assert(selfEntries.length === 1, `${r.tag} roster contains exactly one 'self' entry`);
    assert(selfEntries[0].groupLabel === r.groupLabel, `${r.tag} self roster entry matches assigned group`);
  }

  const p2 = results.find((r) => r.tag === 'P2');
  assert(p2.myCorrect === 0, `P2 (answers everything wrong) recorded 0 correct answers (got ${p2.myCorrect})`);

  const p1 = results.find((r) => r.tag === 'P1');
  assert(p1.myCorrect > 0, `P1 (answers correctly) recorded some correct answers (got ${p1.myCorrect})`);

  for (const r of results) {
    assert(r.scoreboard && r.scoreboard.finished, `${r.tag} scoreboard reports finished after duration elapsed`);
    const totals = r.scoreboard.totals;
    assert(totals.A >= 0 && totals.B >= 0, `${r.tag} scoreboard totals are non-negative`);
    const sumFromTeams = [...r.scoreboard.teams.A, ...r.scoreboard.teams.B].reduce((s, p) => s + p.correctCount, 0);
    assert(sumFromTeams === totals.A + totals.B, `${r.tag} per-member counts sum to team totals`);
    // Critical: simulated bot teammates/opponents must actually generate activity —
    // this specifically catches bot-schedule wiring bugs (e.g. a key mismatch) that
    // would otherwise leave every simulated participant frozen at 0 while the
    // consistency check above still passes vacuously.
    const botEntries = [...r.scoreboard.teams.A, ...r.scoreboard.teams.B].filter((p) => !p.isReal);
    const botTotal = botEntries.reduce((s, p) => s + p.correctCount, 0);
    assert(botTotal > 0, `${r.tag} simulated teammates/opponents produced nonzero activity (got ${botTotal} across ${botEntries.length} bots)`);
  }

  console.log('Verifying admin can see all runs and export combined data...');
  const loginData = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || 'testpass' }) });
  const detailRes = await fetch(`${baseUrl}/api/admin/studies/${studyId}`, { headers: { 'x-admin-token': loginData.token } });
  const detail = await detailRes.json();
  assert(detail.runs.length === 3, `admin sees all 3 runs for the study (got ${detail.runs.length})`);
  assert(detail.runs.every((r) => r.phase === 'done'), 'all runs marked phase=done after full flow');

  const csvRes = await fetch(`${baseUrl}/api/admin/studies/${studyId}/export.csv`, { headers: { 'x-admin-token': loginData.token } });
  const csvText = await csvRes.text();
  assert(csvText.includes('study_id'), 'CSV export contains header row');
  // 3 runs x (1 summary + 4 targets x 2 phases allocations + 2 phases x 3 survey fields) = 3 x (1+8+6) = 45
  const dataLines = csvText.trim().split('\n').length - 1;
  assert(dataLines >= 3 * (1 + roster_len(detail) * 2 + 6), `CSV contains the expected number of data rows (got ${dataLines})`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

function roster_len(detail) {
  // fake_ingroup_count + fake_outgroup_count + 1 (self)
  return detail.study.fake_ingroup_count + detail.study.fake_outgroup_count + 1;
}

main().catch((e) => {
  console.error('Simulation crashed:', e);
  process.exit(1);
});
