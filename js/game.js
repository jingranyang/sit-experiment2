(function () {
  'use strict';

  // =========================================================================
  // This page is designed to run standalone on GitHub Pages and be embedded
  // (via <iframe>) or linked to from a Qualtrics survey. It handles TWO
  // sequential cooperative mini-tasks with computer-simulated teammates and
  // opponents: (1) a math task, (2) a "spot the difference" task (找不同/
  // 大家来找茬). Consent, instructions, allocation tasks, surveys, and
  // debrief are expected to live in Qualtrics itself. See
  // QUALTRICS_INTEGRATION.md for wiring.
  //
  // URL parameters accepted:
  //   pid            participant/response ID to echo back (default: random)
  //   group          'A' or 'B' — assign externally (e.g. from Qualtrics'
  //                  randomizer). If omitted, this page randomizes it itself.
  //   ingroup        number of simulated teammates, excluding the real
  //                  participant (default 4)
  //   outgroup       number of simulated opponents (default 5)
  //   duration       math task duration in seconds (default 180)
  //   difficulty     math task difficulty: 'easy' | 'medium' | 'hard'
  //                  (default 'medium')
  //   diffDuration   spot-the-difference task duration in seconds
  //                  (default 120)
  //   diffDifficulty spot-the-difference difficulty: 'easy' | 'medium' |
  //                  'hard' (default 'medium') — controls how many shapes/
  //                  differences per picture pair
  //   bias           'win' | 'lose' | 'tie' | 'random' — probabilistic
  //                  tendency for the participant's own team across BOTH
  //                  tasks, not a hard guarantee (default 'random')
  //   returnUrl      if set, a "continue" button on the final results screen
  //                  appends result fields (prefixed sit_) to this URL as
  //                  query params and navigates there
  //   origin         targetOrigin for postMessage back to the parent window
  //                  (default '*' — tighten this if you control the
  //                  Qualtrics data center domain)
  //   autostart      '1' skips the intro screen and starts the math task
  //                  immediately
  //   debug          '1' exposes window.__sitDebug with internal state, used
  //                  by the automated test suite to click exact difference
  //                  coordinates instead of guessing pixels
  // =========================================================================

  function randInt(min, max) {
    const range = max - min + 1;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] % range);
  }
  function randFloat(min, max) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return min + (buf[0] / 0xffffffff) * (max - min);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------
  // Config from URL
  // ---------------------------------------------------------------------
  const qs = new URLSearchParams(location.search);
  function clampInt(v, def, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  const CONFIG = {
    pid: qs.get('pid') || ('anon_' + Math.random().toString(36).slice(2, 10)),
    groupParam: (qs.get('group') || '').toUpperCase(),
    inGroupCount: clampInt(qs.get('ingroup'), 4, 0, 50),
    outGroupCount: clampInt(qs.get('outgroup'), 5, 0, 50),
    durationSec: clampInt(qs.get('duration'), 180, 10, 1800),
    difficulty: ['easy', 'medium', 'hard'].includes(qs.get('difficulty')) ? qs.get('difficulty') : 'medium',
    diffDurationSec: clampInt(qs.get('diffDuration'), 120, 10, 1800),
    diffDifficulty: ['easy', 'medium', 'hard'].includes(qs.get('diffDifficulty')) ? qs.get('diffDifficulty') : 'medium',
    bias: ['win', 'lose', 'tie', 'random'].includes(qs.get('bias')) ? qs.get('bias') : 'random',
    returnUrl: qs.get('returnUrl') || '',
    targetOrigin: qs.get('origin') || '*',
    autostart: qs.get('autostart') === '1',
    debug: qs.get('debug') === '1',
  };

  // ---------------------------------------------------------------------
  // Math problem generator
  // ---------------------------------------------------------------------
  function generateProblem(difficulty) {
    let a, b, op, answer;
    const ops = ['+', '-', '*'];
    op = ops[randInt(0, difficulty === 'easy' ? 1 : ops.length - 1)];
    if (difficulty === 'easy') { a = randInt(1, 20); b = randInt(1, 20); }
    else if (difficulty === 'hard') { a = op === '*' ? randInt(2, 12) : randInt(10, 99); b = op === '*' ? randInt(2, 12) : randInt(10, 99); }
    else { a = op === '*' ? randInt(2, 9) : randInt(1, 50); b = op === '*' ? randInt(2, 9) : randInt(1, 50); }
    if (op === '-' && b > a) { [a, b] = [b, a]; }
    if (op === '+') answer = a + b; else if (op === '-') answer = a - b; else answer = a * b;
    return { text: `${a} ${op} ${b}`, answer };
  }

  // ---------------------------------------------------------------------
  // Roster generation (shared across both tasks — same simulated teammates
  // and opponents throughout).
  // ---------------------------------------------------------------------
  function buildRoster() {
    const realGroup = CONFIG.groupParam === 'A' || CONFIG.groupParam === 'B'
      ? CONFIG.groupParam
      : (randInt(0, 1) === 0 ? 'A' : 'B');
    const otherGroup = realGroup === 'A' ? 'B' : 'A';

    const slots = [{ isReal: true, groupLabel: realGroup }];
    for (let i = 0; i < CONFIG.inGroupCount; i++) slots.push({ isReal: false, groupLabel: realGroup, botId: 'bot_' + Math.random().toString(36).slice(2, 10) });
    for (let i = 0; i < CONFIG.outGroupCount; i++) slots.push({ isReal: false, groupLabel: otherGroup, botId: 'bot_' + Math.random().toString(36).slice(2, 10) });

    for (let i = slots.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    let realLabel = null;
    const roster = slots.map((slot, idx) => {
      const label = idx + 1;
      if (slot.isReal) { realLabel = label; return { id: 'self', label, groupLabel: slot.groupLabel, isReal: true }; }
      return { id: slot.botId, label, groupLabel: slot.groupLabel, isReal: false };
    });
    return { roster, realGroup, realLabel };
  }

  // Generic simulated-performance schedule: a list of "point" timestamps per
  // bot persona, reused for both the math task (1 point per correct answer)
  // and the spot-the-difference task (1 point per fully completed picture
  // pair). baseIntervalSec is the average seconds between points for a
  // "typical" bot before per-persona skill variance and outcome bias are
  // applied.
  function generatePointSchedule(roster, realGroupLabel, durationSec, baseIntervalSec, bias) {
    let ownGroupMult = 1, otherGroupMult = 1;
    if (bias === 'win') { otherGroupMult = 1.25; ownGroupMult = 0.92; }
    else if (bias === 'lose') { otherGroupMult = 0.8; ownGroupMult = 1.08; }
    else if (bias === 'tie') { otherGroupMult = 1; ownGroupMult = 1; }

    const schedule = {};
    for (const p of roster) {
      if (p.isReal) continue;
      const groupMult = p.groupLabel === realGroupLabel ? ownGroupMult : otherGroupMult;
      const skill = randFloat(0.75, 1.3);
      const jitterTight = bias === 'tie' ? 0.25 : 0.5;
      const effectiveInterval = baseIntervalSec * groupMult * skill;
      const events = [];
      let t = 0;
      while (t < durationSec) {
        const gap = Math.max(0.8, -Math.log(1 - Math.random()) * effectiveInterval * (1 - jitterTight + Math.random() * jitterTight * 2));
        t += gap;
        if (t < durationSec) events.push(Math.round(t * 1000));
      }
      schedule[p.id] = events;
    }
    return schedule;
  }

  function computeScoreboard(roster, schedule, realGroupLabel, realCount, elapsedMs) {
    const teams = { A: [], B: [] };
    const totals = { A: 0, B: 0 };
    for (const p of roster) {
      const count = p.isReal ? realCount : (schedule[p.id] || []).filter((t) => t <= elapsedMs).length;
      teams[p.groupLabel].push({ id: p.id, label: p.label, correctCount: count, isReal: !!p.isReal });
      totals[p.groupLabel] += count;
    }
    teams.A.sort((a, b) => a.label - b.label);
    teams.B.sort((a, b) => a.label - b.label);
    return { teams, totals };
  }

  const MATH_BASE_INTERVAL_SEC = { easy: 4.5, medium: 6, hard: 8.5 };
  // Average seconds for a bot to complete one full picture pair (i.e. find
  // every difference in it) — roughly (per-difference time) x (diff count).
  const DIFF_BASE_INTERVAL_SEC = { easy: 14, medium: 26, hard: 45 };

  // ---------------------------------------------------------------------
  // Shared state
  // ---------------------------------------------------------------------
  const app = document.getElementById('app');
  const built = buildRoster();
  const S = {
    roster: built.roster,
    group: built.realGroup,
    label: built.realLabel,
    phase: 'intro', // intro | math | math_done | diff | results
    math: { schedule: null, correctCount: 0, currentProblem: null, lastAnswerResult: null, startAt: null, endAt: null, teams: { A: [], B: [] }, totals: { A: 0, B: 0 } },
    diff: { schedule: null, pairsCompleted: 0, round: null, foundInRound: 0, startAt: null, endAt: null, teams: { A: [], B: [] }, totals: { A: 0, B: 0 } },
  };
  if (CONFIG.debug) window.__sitDebug = { get state() { return S; }, CONFIG };

  function render() {
    if (S.phase === 'intro') return renderIntro();
    if (S.phase === 'math') return renderMathPlaying();
    if (S.phase === 'math_done') return renderMathDone();
    if (S.phase === 'diff') return renderDiffPlaying();
    if (S.phase === 'results') return renderResults();
  }

  function renderRosterColumns() {
    const teamA = S.roster.filter((p) => p.groupLabel === 'A');
    const teamB = S.roster.filter((p) => p.groupLabel === 'B');
    const col = (team, list, cls) => `
      <div class="team-col ${cls}">
        <h3>Group ${team}</h3>
        <ul class="member-list">
          ${list.map((p) => `<li class="member-row ${p.id === 'self' ? 'me' : ''}"><span>Participant ${p.label}${p.id === 'self' ? '（你）' : ''}</span></li>`).join('')}
        </ul>
      </div>`;
    return `<div class="team-columns">${col('A', teamA, 'a')}${col('B', teamB, 'b')}</div>`;
  }

  function renderIntro() {
    const groupColor = S.group === 'A' ? 'a' : 'b';
    app.innerHTML = `
      <div class="card center">
        <h1>你被分配到 <span class="badge ${groupColor}">Group ${esc(S.group)}</span></h1>
        <p class="muted">你的编号：Participant ${esc(S.label)}。以下是本轮所有参与者的分组情况。接下来有两个合作任务：先是计算比赛，然后是"大家来找茬"。</p>
      </div>
      <div class="card">
        <h2>队伍名单</h2>
        ${renderRosterColumns()}
        <button id="start-btn" class="mt" style="width:100%;">开始任务一：合作计算</button>
      </div>`;
    document.getElementById('start-btn').addEventListener('click', startMathTask);
  }

  // =======================================================================
  // Task 1: math
  // =======================================================================
  function startMathTask() {
    const m = S.math;
    m.schedule = generatePointSchedule(S.roster, S.group, CONFIG.durationSec, MATH_BASE_INTERVAL_SEC[CONFIG.difficulty], CONFIG.bias);
    m.startAt = Date.now();
    m.endAt = m.startAt + CONFIG.durationSec * 1000;
    S.phase = 'math';
    render();
    mathTick();
    requestProblem();
  }

  let mathTickHandle = null;
  function mathTick() {
    if (mathTickHandle) clearInterval(mathTickHandle);
    mathTickHandle = setInterval(() => {
      const m = S.math;
      const elapsedMs = Math.max(0, Math.min(Date.now(), m.endAt) - m.startAt);
      const { teams, totals } = computeScoreboard(S.roster, m.schedule, S.group, m.correctCount, elapsedMs);
      m.teams = teams; m.totals = totals;
      updateMathScoreboardDom();
      updateMathTimerDom();
      if (Date.now() >= m.endAt) {
        clearInterval(mathTickHandle);
        S.phase = 'math_done';
        render();
      }
    }, 400);
  }

  function requestProblem() {
    const m = S.math;
    if (S.phase !== 'math') return;
    m.currentProblem = generateProblem(CONFIG.difficulty);
    m.lastAnswerResult = null;
    updateProblemDom();
    const inp = document.getElementById('answer-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }

  function submitAnswer(value) {
    const m = S.math;
    if (!m.currentProblem || S.phase !== 'math') return;
    const isCorrect = Number(value) === m.currentProblem.answer;
    if (isCorrect) m.correctCount++;
    m.lastAnswerResult = isCorrect ? 'correct' : 'wrong';
    updateProblemDom();
    setTimeout(requestProblem, 150);
  }

  function renderMathPlaying() {
    const m = S.math;
    const msLeft = Math.max(0, (m.endAt || Date.now() + CONFIG.durationSec * 1000) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">任务一 · 剩余时间 <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <div class="problem-box" id="problem-box">
          <div class="problem-text">${m.currentProblem ? esc(m.currentProblem.text) + ' = ?' : '…'}</div>
          <input type="number" id="answer-input" placeholder="输入答案后按回车" autocomplete="off" style="max-width:200px; margin:0 auto; text-align:center; font-size:1.2rem;" />
        </div>
      </div>
      <div class="card">
        <h2>实时计分板</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml(m.teams, m.totals)}</div>
      </div>`;
    const inp = document.getElementById('answer-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value !== '') submitAnswer(inp.value); });
      inp.focus();
    }
  }

  function updateMathTimerDom() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(Math.max(0, S.math.endAt - Date.now()) / 1000));
  }
  function updateMathScoreboardDom() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml(S.math.teams, S.math.totals);
  }
  function updateProblemDom() {
    const box = document.getElementById('problem-box');
    if (!box) return;
    const m = S.math;
    box.querySelector('.problem-text').textContent = m.currentProblem ? `${m.currentProblem.text} = ?` : '…';
    const inp = document.getElementById('answer-input');
    if (inp) inp.value = '';
    if (m.lastAnswerResult) {
      box.classList.remove('flash', 'flash-bad');
      void box.offsetWidth;
      box.classList.add(m.lastAnswerResult === 'correct' ? 'flash' : 'flash-bad');
    }
  }

  function renderScoreboardHtml(teams, totals) {
    const col = (team, cls) => {
      const list = (teams[team] || []).slice().sort((a, b) => a.label - b.label);
      return `
        <div class="team-col ${cls}">
          <h3>Group ${team}${team === S.group ? '（你的队伍）' : ''}</h3>
          <div class="team-total">${totals[team] || 0}</div>
          <ul class="member-list">
            ${list.map((p) => `<li class="member-row ${p.isReal ? 'me' : ''}"><span>Participant ${p.label}${p.isReal ? '（你）' : ''}</span><span class="count">${p.correctCount}</span></li>`).join('')}
          </ul>
        </div>`;
    };
    return `<div class="team-columns">${col('A', 'a')}${col('B', 'b')}</div>`;
  }

  function renderMathDone() {
    const m = S.math;
    app.innerHTML = `
      <div class="card center">
        <h1>任务一结束</h1>
        <p class="lead">你一共答对了 ${m.correctCount} 题。接下来是任务二："大家来找茬"——和你的队友、对方队伍比一比，看谁能更快找出两幅图之间的所有不同之处。</p>
        ${renderScoreboardHtml(m.teams, m.totals)}
        <button id="start-diff-btn" class="mt" style="width:100%;">开始任务二：大家来找茬</button>
      </div>`;
    document.getElementById('start-diff-btn').addEventListener('click', startDiffTask);
  }

  // =======================================================================
  // Task 2: spot the difference (大家来找茬)
  // =======================================================================
  const DIFF_CANVAS_W = 260, DIFF_CANVAS_H = 210;

  function startDiffTask() {
    const d = S.diff;
    d.schedule = generatePointSchedule(S.roster, S.group, CONFIG.diffDurationSec, DIFF_BASE_INTERVAL_SEC[CONFIG.diffDifficulty], CONFIG.bias);
    d.startAt = Date.now();
    d.endAt = d.startAt + CONFIG.diffDurationSec * 1000;
    d.pairsCompleted = 0;
    S.phase = 'diff';
    render();
    diffTick();
    nextDiffRound();
  }

  let diffTickHandle = null;
  function diffTick() {
    if (diffTickHandle) clearInterval(diffTickHandle);
    diffTickHandle = setInterval(() => {
      const d = S.diff;
      const elapsedMs = Math.max(0, Math.min(Date.now(), d.endAt) - d.startAt);
      const { teams, totals } = computeScoreboard(S.roster, d.schedule, S.group, d.pairsCompleted, elapsedMs);
      d.teams = teams; d.totals = totals;
      updateDiffScoreboardDom();
      updateDiffTimerDom();
      if (Date.now() >= d.endAt) {
        clearInterval(diffTickHandle);
        S.phase = 'results';
        render();
        reportCompletion();
      }
    }, 400);
  }

  function nextDiffRound() {
    const d = S.diff;
    if (S.phase !== 'diff') return;
    d.round = SpotDiff.generateRound(DIFF_CANVAS_W, DIFF_CANVAS_H, CONFIG.diffDifficulty);
    d.foundInRound = 0;
    drawDiffCanvases();
    updateDiffProgressDom();
  }

  function drawDiffCanvases() {
    const d = S.diff;
    const canvasA = document.getElementById('diff-canvas-a');
    const canvasB = document.getElementById('diff-canvas-b');
    if (canvasA) SpotDiff.render(canvasA, d.round.shapesA, d.round, 'A');
    if (canvasB) SpotDiff.render(canvasB, d.round.shapesB, d.round, 'B');
  }

  function handleDiffClick(side, evt) {
    const d = S.diff;
    if (S.phase !== 'diff' || !d.round) return;
    const rect = evt.target.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const tolerance = SpotDiff.DIFFICULTY[CONFIG.diffDifficulty].tolerance;
    const hit = SpotDiff.hitTest(d.round, side, x, y, tolerance);
    if (!hit) return;
    hit.found = true;
    d.foundInRound++;
    drawDiffCanvases();
    updateDiffProgressDom();
    if (d.foundInRound >= d.round.diffs.length) {
      d.pairsCompleted++;
      updateDiffScoreboardDomImmediate();
      setTimeout(nextDiffRound, 550);
    }
  }

  function updateDiffScoreboardDomImmediate() {
    const d = S.diff;
    const elapsedMs = Math.max(0, Math.min(Date.now(), d.endAt) - d.startAt);
    const { teams, totals } = computeScoreboard(S.roster, d.schedule, S.group, d.pairsCompleted, elapsedMs);
    d.teams = teams; d.totals = totals;
    updateDiffScoreboardDom();
  }

  function renderDiffPlaying() {
    const d = S.diff;
    const msLeft = Math.max(0, (d.endAt || Date.now() + CONFIG.diffDurationSec * 1000) - Date.now());
    app.innerHTML = `
      <div class="card">
        <div class="timer">任务二 · 剩余时间 <span id="timer-display">${formatTime(Math.ceil(msLeft / 1000))}</span></div>
        <p class="center muted" id="diff-progress">找找看两张图有什么不同吧</p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <canvas id="diff-canvas-a" width="${DIFF_CANVAS_W}" height="${DIFF_CANVAS_H}" style="border-radius:8px; cursor:crosshair;"></canvas>
          <canvas id="diff-canvas-b" width="${DIFF_CANVAS_W}" height="${DIFF_CANVAS_H}" style="border-radius:8px; cursor:crosshair;"></canvas>
        </div>
        <p class="center muted mt" style="font-size:0.85rem;">已完成 <span id="diff-completed">${d.pairsCompleted}</span> 组</p>
      </div>
      <div class="card">
        <h2>实时计分板（完成组数）</h2>
        <div id="scoreboard-slot">${renderScoreboardHtml(d.teams, d.totals)}</div>
      </div>`;
    const canvasA = document.getElementById('diff-canvas-a');
    const canvasB = document.getElementById('diff-canvas-b');
    canvasA.addEventListener('click', (e) => handleDiffClick('A', e));
    canvasB.addEventListener('click', (e) => handleDiffClick('B', e));
    if (d.round) drawDiffCanvases();
  }

  function updateDiffTimerDom() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(Math.ceil(Math.max(0, S.diff.endAt - Date.now()) / 1000));
  }
  function updateDiffScoreboardDom() {
    const el = document.getElementById('scoreboard-slot');
    if (el) el.innerHTML = renderScoreboardHtml(S.diff.teams, S.diff.totals);
  }
  function updateDiffProgressDom() {
    const d = S.diff;
    const p = document.getElementById('diff-progress');
    if (p) p.textContent = d.round ? `本轮已找到 ${d.foundInRound} / ${d.round.diffs.length} 处不同` : '';
    const c = document.getElementById('diff-completed');
    if (c) c.textContent = d.pairsCompleted;
  }

  // =======================================================================
  // Results + handoff back to Qualtrics
  // =======================================================================
  function outcomeFor(totals, group) {
    const own = totals[group] || 0;
    const other = totals[group === 'A' ? 'B' : 'A'] || 0;
    if (own === other) return 'tie';
    return own > other ? 'win' : 'lose';
  }

  function resultPayload() {
    const m = S.math, d = S.diff;
    const mathOutcome = outcomeFor(m.totals, S.group);
    const diffOutcome = outcomeFor(d.totals, S.group);
    const mathTeamTotal = m.totals[S.group] || 0;
    const otherGroup = S.group === 'A' ? 'B' : 'A';
    const mathOtherTotal = m.totals[otherGroup] || 0;
    const diffTeamTotal = d.totals[S.group] || 0;
    const diffOtherTotal = d.totals[otherGroup] || 0;
    const overallOwnTeamTotal = mathTeamTotal + diffTeamTotal;
    const overallOtherTeamTotal = mathOtherTotal + diffOtherTotal;
    let overallOutcome = 'tie';
    if (overallOwnTeamTotal !== overallOtherTeamTotal) overallOutcome = overallOwnTeamTotal > overallOtherTeamTotal ? 'win' : 'lose';

    return {
      pid: CONFIG.pid,
      group: S.group,
      mathOwnCorrect: m.correctCount,
      mathTeamTotal, mathOtherTeamTotal: mathOtherTotal, mathOutcome,
      mathDurationSec: CONFIG.durationSec,
      diffPairsCompleted: d.pairsCompleted,
      diffTeamTotal, diffOtherTeamTotal: diffOtherTotal, diffOutcome,
      diffDurationSec: CONFIG.diffDurationSec,
      overallOwnTeamTotal, overallOtherTeamTotal, overallOutcome,
    };
  }

  function renderResults() {
    const payload = resultPayload();
    const outcomeLabel = { win: '获胜', lose: '落后', tie: '平手' };
    app.innerHTML = `
      <div class="card center">
        <h1>两个任务都完成了！</h1>
        <p class="lead">任务一（计算）：你答对 ${payload.mathOwnCorrect} 题，本队 ${payload.mathTeamTotal} : 对方 ${payload.mathOtherTeamTotal}（${outcomeLabel[payload.mathOutcome]}）</p>
        <p class="lead">任务二（找茬）：你完成 ${payload.diffPairsCompleted} 组，本队 ${payload.diffTeamTotal} : 对方 ${payload.diffOtherTeamTotal}（${outcomeLabel[payload.diffOutcome]}）</p>
        <div id="continue-slot" class="mt"></div>
      </div>`;

    const slot = document.getElementById('continue-slot');
    if (CONFIG.returnUrl) {
      const btn = document.createElement('button');
      btn.style.width = '100%';
      btn.textContent = '继续（返回问卷）';
      btn.addEventListener('click', () => {
        const url = new URL(CONFIG.returnUrl);
        Object.entries(payload).forEach(([k, v]) => url.searchParams.set('sit_' + k, v));
        location.href = url.toString();
      });
      slot.appendChild(btn);
    } else {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.innerHTML = '本页未配置返回地址（returnUrl），如果这个页面是被 Qualtrics 用 iframe 嵌入的，结果已经通过 postMessage 自动发送，无需额外操作。';
      slot.appendChild(notice);
    }
  }

  function reportCompletion() {
    const payload = resultPayload();
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'sit_task_complete', payload }, CONFIG.targetOrigin);
      }
    } catch (e) { /* cross-origin parent access errors are expected/harmless here */ }
  }

  if (CONFIG.autostart) {
    startMathTask();
  } else {
    render();
  }
})();
